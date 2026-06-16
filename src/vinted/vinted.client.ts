import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RawVintedItem, VintedItem, VintedSearchFilters } from './vinted.types';

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
      // On ne garde que la paire clé=valeur de chaque cookie (sans les attributs).
      this.cookie = setCookie
        .map((c) => c.split(';')[0])
        .filter((c) => c.includes('='))
        .join('; ');

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
    return params;
  }

  private normalize(raw: RawVintedItem): VintedItem {
    const ts = raw.photo?.high_resolution?.timestamp;
    return {
      id: raw.id,
      title: raw.title,
      price: raw.price ? Number(raw.price.amount) : 0,
      currency: raw.price?.currency_code ?? 'EUR',
      url: raw.url,
      photoUrl: raw.photo?.url,
      brand: raw.brand_title,
      size: raw.size_title,
      sellerLogin: raw.user?.login,
      publishedAt: ts ? new Date(ts * 1000) : undefined,
    };
  }
}
