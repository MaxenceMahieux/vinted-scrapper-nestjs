import { Injectable, Logger } from '@nestjs/common';
import { SavedSearch } from '@prisma/client';
import {
  EnrichedVintedItem,
  ListingsService,
} from '../listings/listings.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationPayload } from '../notifier/channel.interface';
import { NotifierService } from '../notifier/notifier.service';
import { normalizeModelKey } from '../pricing/model-key.util';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchesService } from '../searches/searches.service';
import { VintedClient } from '../vinted/vinted.client';

/** Résumé d'un cycle de scraping pour une recherche. */
export interface ScrapeRunResult {
  searchName: string;
  enabled: boolean;
  fetched: number;
  matched: number;
  fresh: number;
  notified: number;
}

/**
 * Logique d'un cycle de scraping pour UNE recherche, partagée entre le worker
 * BullMQ planifié et l'exécution à la demande (diagnostic).
 */
@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vinted: VintedClient,
    private readonly listings: ListingsService,
    private readonly notifier: NotifierService,
    private readonly searches: SearchesService,
    private readonly matching: MatchingService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Exécute un cycle complet : Vinted → filtrage → observations → scoring →
   * dédup → notification. Lève en cas d'erreur (pour que BullMQ retente).
   */
  async runOnce(searchId: string): Promise<ScrapeRunResult> {
    const search = await this.prisma.savedSearch.findUnique({
      where: { id: searchId },
    });
    if (!search) {
      return this.emptyResult('introuvable', false);
    }
    if (!search.enabled) {
      return this.emptyResult(search.name, false);
    }

    // 1) Fetch Vinted avec tous les filtres.
    const rawItems = await this.vinted.searchCatalog({
      searchText: search.searchText,
      catalogIds: search.catalogIds,
      brandIds: search.brandIds,
      statusIds: search.statusIds,
      sizeIds: search.sizeIds,
      priceFrom: search.priceFrom ? Number(search.priceFrom) : null,
      priceTo: search.priceTo ? Number(search.priceTo) : null,
      order: search.order,
      country: search.country,
    });

    // 2) Filtrage local include/exclude.
    const items = this.matching.filter(rawItems, {
      includeKeywords: search.includeKeywords,
      excludeKeywords: search.excludeKeywords,
    });

    if (!items.length) {
      await this.searches.markRun(searchId);
      return {
        searchName: search.name,
        enabled: true,
        fetched: rawItems.length,
        matched: 0,
        fresh: 0,
        notified: 0,
      };
    }

    // 3) Observations de prix.
    await this.pricing.recordObservations(
      searchId,
      items.map((item) => ({
        vintedItemId: item.id,
        price: item.price,
        currency: item.currency,
        modelKey: normalizeModelKey(item.title),
      })),
    );

    // 4) Enrichissement + scoring.
    const enriched: EnrichedVintedItem[] = [];
    for (const item of items) {
      const modelKey = normalizeModelKey(item.title);
      const deal = await this.pricing.scoreDeal(item.price, modelKey);
      enriched.push({
        ...item,
        modelKey,
        dealScore: deal.score,
        isDeal: deal.isDeal,
      });
    }

    // 5) Persistance + dédup.
    const fresh = await this.listings.saveNew(searchId, enriched);
    await this.searches.markRun(searchId);

    if (!fresh.length) {
      return {
        searchName: search.name,
        enabled: true,
        fetched: rawItems.length,
        matched: items.length,
        fresh: 0,
        notified: 0,
      };
    }

    // 6) Notification.
    const toNotify = fresh.filter((listing) =>
      this.shouldNotify(search, listing),
    );

    this.logger.log(
      `${fresh.length} nouvelle(s) annonce(s), ${toNotify.length} à notifier — ${search.name}`,
    );

    for (const listing of toNotify) {
      const payload: NotificationPayload = {
        searchName: search.name,
        title: listing.title,
        price: Number(listing.price),
        currency: listing.currency,
        url: listing.url,
        brand: listing.brand ?? undefined,
        size: listing.size ?? undefined,
        photoUrl: listing.photoUrl ?? undefined,
        isDeal: listing.isDeal,
        dealScore: listing.dealScore ?? undefined,
      };
      await this.notifier.dispatch(search.channels, payload);
    }

    if (toNotify.length) {
      await this.listings.markNotified(toNotify.map((l) => l.id));
    }

    return {
      searchName: search.name,
      enabled: true,
      fetched: rawItems.length,
      matched: items.length,
      fresh: fresh.length,
      notified: toNotify.length,
    };
  }

  private emptyResult(name: string, enabled: boolean): ScrapeRunResult {
    return {
      searchName: name,
      enabled,
      fetched: 0,
      matched: 0,
      fresh: 0,
      notified: 0,
    };
  }

  private shouldNotify(
    search: SavedSearch,
    listing: { isDeal: boolean; dealScore: number | null },
  ): boolean {
    if (!search.dealOnly) return true;
    if (!listing.isDeal) return false;
    if (search.minDealScore != null) {
      return (listing.dealScore ?? 0) >= search.minDealScore;
    }
    return true;
  }
}
