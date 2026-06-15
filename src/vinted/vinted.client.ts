import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  RawVintedItem,
  VintedItem,
  VintedSearchFilters,
} from './vinted.types';

/**
 * Client de l'API interne (non officielle) de Vinted.
 *
 * Vinted n'a pas d'API publique mais expose `/api/v2/catalog/items`, accessible
 * avec un cookie de session anonyme. Ce client récupère ce cookie automatiquement
 * en visitant la home, le met en cache, et le rafraîchit en cas de 401/403.
 *
 * Anti-ban : User-Agent réaliste + un seul cookie réutilisé. Le throttling
 * (délai entre requêtes) est géré en amont par BullMQ (1 job / recherche).
 */
@Injectable()
export class VintedClient {
  private readonly logger = new Logger(VintedClient.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  private cookie: string | null = null;

  private static readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>(
      'VINTED_BASE_URL',
      'https://www.vinted.fr',
    );
    this.http = axios.create({
      timeout: 10_000,
      headers: {
        'User-Agent': VintedClient.USER_AGENT,
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Accept: 'application/json, text/plain, */*',
      },
    });
  }

  /** Récupère un cookie de session anonyme en visitant la home Vinted. */
  private async refreshSession(): Promise<void> {
    const res = await this.http.get(this.baseUrl, {
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
    this.logger.debug('Session Vinted rafraîchie');
  }

  /**
   * Interroge le catalogue. Rafraîchit la session une fois en cas d'auth échouée.
   */
  async searchCatalog(filters: VintedSearchFilters): Promise<VintedItem[]> {
    if (!this.cookie) {
      await this.refreshSession();
    }
    try {
      return await this.requestCatalog(filters);
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 401 || status === 403) {
        this.logger.warn(`Auth Vinted échouée (${status}), refresh du cookie`);
        await this.refreshSession();
        return this.requestCatalog(filters);
      }
      throw err;
    }
  }

  private async requestCatalog(
    filters: VintedSearchFilters,
  ): Promise<VintedItem[]> {
    const params: Record<string, string | number> = {
      order: filters.order ?? 'newest_first',
      per_page: filters.perPage ?? 20,
    };
    if (filters.searchText) params.search_text = filters.searchText;
    if (filters.catalogIds?.length)
      params.catalog_ids = filters.catalogIds.join(',');
    if (filters.brandIds?.length) params.brand_ids = filters.brandIds.join(',');
    if (filters.priceFrom != null) params.price_from = filters.priceFrom;
    if (filters.priceTo != null) params.price_to = filters.priceTo;

    const res = await this.http.get(`${this.baseUrl}/api/v2/catalog/items`, {
      params,
      headers: { Cookie: this.cookie as string },
    });

    const items: RawVintedItem[] = res.data?.items ?? [];
    return items.map((raw) => this.normalize(raw));
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
