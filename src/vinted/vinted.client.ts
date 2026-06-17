import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  RawVintedFilter,
  RawVintedItem,
  RawVintedItemDetail,
  VintedAmount,
  VintedFacet,
  VintedItem,
  VintedItemDetail,
  VintedSearchFilters,
} from './vinted.types';

/**
 * Client de l'API interne (non officielle) de Vinted.
 *
 * Vinted n'a pas d'API publique mais expose `/api/v2/catalog/items`, accessible
 * avec un cookie de session anonyme. Ce client récupère ce cookie automatiquement
 * en visitant la home, le met en cache, et le rafraîchit en cas de 401/403.
 *
 * Anti-ban : User-Agent réaliste + un seul cookie réutilisé + throttle interne
 * (délai aléatoire avant chaque requête catalog) + backoff sur 429. Le throttling
 * global entre recherches reste géré en amont par BullMQ (1 job / recherche).
 */
@Injectable()
export class VintedClient {
  private readonly logger = new Logger(VintedClient.name);
  private readonly http: AxiosInstance;
  /** baseUrl de repli si le pays n'est pas reconnu (env VINTED_BASE_URL). */
  private readonly fallbackBaseUrl: string;
  private cookie: string | null = null;

  /** Domaines Vinted par code pays ISO (2 lettres). */
  private static readonly COUNTRY_DOMAINS: Record<string, string> = {
    fr: 'https://www.vinted.fr',
    de: 'https://www.vinted.de',
    it: 'https://www.vinted.it',
    es: 'https://www.vinted.es',
    be: 'https://www.vinted.be',
  };

  /** Délai min/max (ms) du throttle aléatoire avant chaque requête catalog. */
  private static readonly THROTTLE_MIN_MS = 800;
  private static readonly THROTTLE_MAX_MS = 2500;
  /** Backoff (ms) appliqué avant retry après un 429. */
  private static readonly RATE_LIMIT_BACKOFF_MS = 5000;

  private static readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  constructor(private readonly config: ConfigService) {
    this.fallbackBaseUrl = this.config.get<string>(
      'VINTED_BASE_URL',
      'https://www.vinted.fr',
    );

    // Proxy optionnel (idéalement résidentiel) pour contourner le blocage
    // anti-bot par IP. Format: http://user:pass@host:port. Si absent, requêtes
    // directes (suffisant en local ou sur une IP non bloquée).
    const proxyUrl = this.config.get<string>('VINTED_PROXY_URL');
    const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
    if (proxyUrl) {
      this.logger.log('Client Vinted: proxy activé');
    }

    this.http = axios.create({
      timeout: 15_000,
      httpsAgent,
      // Laisse l'agent gérer le proxy (désactive la gestion proxy native d'axios).
      proxy: false,
      headers: {
        'User-Agent': VintedClient.USER_AGENT,
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Accept: 'application/json, text/plain, */*',
      },
    });
  }

  /** Résout la baseUrl à partir du code pays, avec repli sur VINTED_BASE_URL. */
  private resolveBaseUrl(country?: string): string {
    if (!country) return this.fallbackBaseUrl;
    const domain = VintedClient.COUNTRY_DOMAINS[country.toLowerCase()];
    if (!domain) {
      this.logger.warn(
        `Pays Vinted inconnu "${country}", repli sur ${this.fallbackBaseUrl}`,
      );
      return this.fallbackBaseUrl;
    }
    return domain;
  }

  /** Pause asynchrone. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Délai aléatoire dans la plage de throttle configurée. */
  private async throttle(): Promise<void> {
    const { THROTTLE_MIN_MS, THROTTLE_MAX_MS } = VintedClient;
    const delay =
      THROTTLE_MIN_MS +
      Math.floor(Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS + 1));
    await this.sleep(delay);
  }

  /**
   * Récupère un cookie de session anonyme en visitant la home Vinted.
   * Le cookie n'est pas lié au pays : on utilise la baseUrl fournie (ou fallback).
   */
  private async refreshSession(baseUrl?: string): Promise<void> {
    const target = baseUrl ?? this.fallbackBaseUrl;
    try {
      const res = await this.http.get(target, {
        headers: { Accept: 'text/html' },
      });
      const setCookie = res.headers['set-cookie'] ?? [];
      this.cookie = this.buildCookieHeader(setCookie);

      if (!this.cookie) {
        throw new Error('Impossible de récupérer un cookie de session Vinted');
      }
      this.logger.debug(`Session Vinted rafraîchie (${target})`);
    } catch (err) {
      this.logger.error(
        `Échec du rafraîchissement de session Vinted (${target})`,
        err as Error,
      );
      throw err;
    }
  }

  /**
   * GET authentifié sur l'API Vinted, partageant la session de ce client.
   * Gère l'acquisition initiale du cookie, le throttle, le retry 401/403 et le
   * backoff 429. Exposé pour réutilisation par d'autres providers (discovery).
   */
  async authenticatedGet<T = unknown>(
    path: string,
    options: { params?: Record<string, unknown>; country?: string } = {},
  ): Promise<T> {
    const baseUrl = this.resolveBaseUrl(options.country);
    if (!this.cookie) {
      await this.refreshSession(baseUrl);
    }

    const config: AxiosRequestConfig = {
      params: options.params,
      headers: { Cookie: this.cookie as string },
    };
    const url = `${baseUrl}${path}`;

    await this.throttle();
    try {
      return await this.doGet<T>(url, config);
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 401 || status === 403) {
        this.logger.warn(`Auth Vinted échouée (${status}), refresh du cookie`);
        await this.refreshSession(baseUrl);
        config.headers = { Cookie: this.cookie as string };
        return this.doGet<T>(url, config);
      }
      if (status === 429) {
        this.logger.warn(
          `Rate limit Vinted (429), backoff ${VintedClient.RATE_LIMIT_BACKOFF_MS}ms`,
        );
        await this.sleep(VintedClient.RATE_LIMIT_BACKOFF_MS);
        return this.doGet<T>(url, config);
      }
      this.logger.error(
        `Requête Vinted échouée (${status ?? 'no status'}) sur ${url}`,
        err as Error,
      );
      throw err;
    }
  }

  /** Exécute le GET HTTP brut. */
  private async doGet<T>(url: string, config: AxiosRequestConfig): Promise<T> {
    const res = await this.http.get<T>(url, config);
    return res.data;
  }

  /**
   * Construit l'en-tête Cookie à partir des Set-Cookie de la réponse.
   *
   * Vinted renvoie certains cookies plusieurs fois (ex. `access_token_web` est
   * d'abord vidé puis défini). On déduplique donc par nom en gardant la
   * DERNIÈRE valeur NON VIDE — comme le ferait un navigateur. Sans ça, on
   * enverrait `access_token_web=; access_token_web=eyJ...` et le serveur lirait
   * la première occurrence (vide) → 401.
   */
  private buildCookieHeader(setCookie: string[]): string {
    const jar = new Map<string, string>();
    for (const entry of setCookie) {
      const pair = entry.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') continue; // ignore les purges de cookie
      jar.set(name, value); // la dernière valeur non vide l'emporte
    }
    return Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * Sonde de diagnostic : refait le flux complet (page d'accueil → API) en
   * capturant chaque statut HTTP, sans utiliser le cookie en cache et sans
   * lever d'exception. Permet de savoir précisément où ça casse (IP bloquée,
   * token absent, token rejeté).
   */
  async selfTest(filters: VintedSearchFilters): Promise<{
    proxy: boolean;
    homeStatus: number | string;
    tokenCaptured: boolean;
    cookieNames: string[];
    apiStatus: number | string;
    fetched: number;
  }> {
    const baseUrl = this.resolveBaseUrl(filters.country);
    const result = {
      proxy: Boolean(this.config.get<string>('VINTED_PROXY_URL')),
      homeStatus: 'n/a' as number | string,
      tokenCaptured: false,
      cookieNames: [] as string[],
      apiStatus: 'n/a' as number | string,
      fetched: 0,
    };

    // 1) Page d'accueil → cookies (validateStatus: on ne lève jamais).
    let cookie = '';
    try {
      const home = await this.http.get(baseUrl, {
        headers: { Accept: 'text/html' },
        validateStatus: () => true,
      });
      result.homeStatus = home.status;
      const setCookie = home.headers['set-cookie'] ?? [];
      result.cookieNames = setCookie.map((c) => c.split('=')[0]);
      cookie = this.buildCookieHeader(setCookie);
      result.tokenCaptured = cookie.includes('access_token_web=');
    } catch (err) {
      result.homeStatus = (err as Error).message;
      return result;
    }

    // 2) Appel API avec ces cookies.
    try {
      const api = await this.http.get<{ items?: RawVintedItem[] }>(
        `${baseUrl}/api/v2/catalog/items`,
        {
          params: this.buildCatalogParams(filters),
          headers: { Cookie: cookie },
          validateStatus: () => true,
        },
      );
      result.apiStatus = api.status;
      result.fetched = api.data?.items?.length ?? 0;
    } catch (err) {
      result.apiStatus = (err as Error).message;
    }

    return result;
  }

  /**
   * Interroge le catalogue. Applique throttle, retry auth et backoff 429 via
   * authenticatedGet.
   */
  async searchCatalog(filters: VintedSearchFilters): Promise<VintedItem[]> {
    const data = await this.authenticatedGet<{ items?: RawVintedItem[] }>(
      '/api/v2/catalog/items',
      { params: this.buildCatalogParams(filters), country: filters.country },
    );
    const items: RawVintedItem[] = data?.items ?? [];
    return items.map((raw) => this.normalize(raw));
  }

  /** Construit les query params catalog/items à partir des filtres. */
  private buildCatalogParams(
    filters: VintedSearchFilters,
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      order: filters.order ?? 'newest_first',
      per_page: filters.perPage ?? 20,
    };
    if (filters.searchText) params.search_text = filters.searchText;
    if (filters.catalogIds?.length)
      params.catalog_ids = filters.catalogIds.join(',');
    if (filters.brandIds?.length) params.brand_ids = filters.brandIds.join(',');
    if (filters.statusIds?.length)
      params.status_ids = filters.statusIds.join(',');
    if (filters.sizeIds?.length) params.size_ids = filters.sizeIds.join(',');
    if (filters.priceFrom != null) params.price_from = filters.priceFrom;
    if (filters.priceTo != null) params.price_to = filters.priceTo;
    this.appendFacets(params, filters.facets);
    return params;
  }

  /**
   * Fusionne les facettes génériques (material_ids, color_ids, …) dans la query.
   * Sanitise les clés (`[a-z][a-z0-9_]*`) et les valeurs (entiers finis), et
   * n'écrase jamais un paramètre déjà construit par un champ typé.
   */
  private appendFacets(
    params: Record<string, string | number>,
    facets: VintedSearchFilters['facets'],
  ): void {
    if (!facets || typeof facets !== 'object') return;
    for (const [key, value] of Object.entries(facets)) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) continue;
      if (key in params) continue;
      const ids = (Array.isArray(value) ? value : [])
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (ids.length) params[key] = ids.join(',');
    }
  }

  /**
   * Découvre les facettes de filtres disponibles pour une catégorie (matière,
   * couleur, etc.) afin de résoudre les IDs d'options par leur libellé.
   *
   * NOTE: le chemin exact de cet endpoint a évolué selon les versions de Vinted ;
   * il est configurable via VINTED_FILTERS_PATH et à confirmer en prod (proxy +
   * cookies). En cas de réponse inattendue, renvoie une liste vide sans lever.
   */
  async getCatalogFilters(
    catalogId: number,
    country?: string,
  ): Promise<VintedFacet[]> {
    const path = this.config.get<string>(
      'VINTED_FILTERS_PATH',
      '/api/v2/catalog/filters',
    );
    try {
      const data = await this.authenticatedGet<{
        filters?: RawVintedFilter[];
        dynamic_filters?: RawVintedFilter[];
      }>(path, { params: { catalog_ids: catalogId }, country });

      const raw = data?.filters ?? data?.dynamic_filters ?? [];
      return raw
        .filter((f): f is RawVintedFilter & { code: string } => Boolean(f.code))
        .map((f) => this.normalizeFacet(f));
    } catch (err) {
      this.logger.warn(
        `Découverte des facettes échouée (catalogId=${catalogId}): ${(err as Error).message}`,
      );
      return [];
    }
  }

  /** Normalise une facette brute en {@link VintedFacet}. */
  private normalizeFacet(raw: RawVintedFilter & { code: string }): VintedFacet {
    const options = (raw.options ?? [])
      .map((o) => ({ id: o.id ?? o.value, title: o.title ?? '' }))
      .filter((o): o is VintedFacet['options'][number] => o.id != null);
    const paramKey = raw.code.endsWith('_ids') ? raw.code : `${raw.code}_ids`;
    return { code: raw.code, paramKey, title: raw.title ?? raw.code, options };
  }

  /**
   * Récupère le détail d'un article par son id (pour le suivi de prix). Renvoie
   * null si l'annonce a disparu (404). Le prix renvoyé est le prix effectif
   * (article + protection acheteurs) afin de rester cohérent avec le scoring.
   */
  async getItem(
    id: number,
    country?: string,
  ): Promise<VintedItemDetail | null> {
    try {
      const data = await this.authenticatedGet<{ item?: RawVintedItemDetail }>(
        `/api/v2/items/${id}`,
        { country },
      );
      const raw = data?.item;
      if (!raw) return null;

      const itemPrice = raw.price ? Number(raw.price.amount) : 0;
      return {
        id: raw.id,
        title: raw.title,
        url: raw.url,
        price: VintedClient.parseAmount(raw.total_item_price) ?? itemPrice,
        currency: raw.price?.currency_code ?? raw.currency ?? 'EUR',
        photoUrl: raw.photos?.[0]?.url,
        available: !raw.is_closed && !raw.is_hidden,
      };
    } catch (err) {
      if ((err as AxiosError).response?.status === 404) return null;
      throw err;
    }
  }

  private normalize(raw: RawVintedItem): VintedItem {
    const ts = raw.photo?.high_resolution?.timestamp;
    const price = raw.price ? Number(raw.price.amount) : 0;
    return {
      id: raw.id,
      title: raw.title,
      price,
      totalPrice: VintedClient.parseAmount(raw.total_item_price) ?? price,
      currency: raw.price?.currency_code ?? 'EUR',
      url: raw.url,
      photoUrl: raw.photo?.url,
      brand: raw.brand_title,
      size: raw.size_title,
      condition: raw.status,
      statusId: raw.status_id,
      sellerLogin: raw.user?.login,
      publishedAt: ts ? new Date(ts * 1000) : undefined,
    };
  }

  /**
   * Extrait un montant numérique des formes hétérogènes renvoyées par Vinted
   * (objet `{ amount }`, nombre ou chaîne). Renvoie null si non exploitable.
   */
  private static parseAmount(value: VintedAmount | undefined): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value.amount === 'string') {
      const n = Number(value.amount);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
}
