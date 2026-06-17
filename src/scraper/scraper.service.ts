import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SavedSearch } from '@prisma/client';
import { Queue } from 'bullmq';
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
import { TrackingService } from '../tracking/tracking.service';
import { VintedClient } from '../vinted/vinted.client';
import { SCRAPE_QUEUE } from './scraper.constants';

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

  // Compteurs d'observabilité pour distinguer cron (enfilage) et worker (traitement).
  private ticks = 0;
  private lastTickAt: string | null = null;
  private workerRuns = 0;
  private lastWorkerRunAt: string | null = null;
  private lastEnqueueCount = 0;
  private lastEnqueueError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vinted: VintedClient,
    private readonly listings: ListingsService,
    private readonly notifier: NotifierService,
    private readonly searches: SearchesService,
    private readonly matching: MatchingService,
    private readonly pricing: PricingService,
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
    @InjectQueue(SCRAPE_QUEUE) private readonly queue: Queue,
  ) {}

  /** Appelé par le cron à chaque tick d'enfilage. */
  recordTick(): void {
    this.ticks += 1;
    this.lastTickAt = new Date().toISOString();
  }

  /** Appelé par le worker BullMQ à chaque job réellement traité. */
  recordWorkerRun(): void {
    this.workerRuns += 1;
    this.lastWorkerRunAt = new Date().toISOString();
  }

  /**
   * Appelé par le cron après tentative d'enfilage. `count` = nombre de
   * recherches enfilées (0 = aucune active, -1 = erreur).
   */
  recordEnqueue(count: number, error?: string): void {
    this.lastEnqueueCount = count;
    this.lastEnqueueError = error ?? null;
  }

  /** Diagnostic : compteurs cron/worker + état de la file BullMQ. */
  async getDiagnostics(): Promise<Record<string, unknown>> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    return {
      cron: this.config.get<string>('SCRAPE_CRON', '*/60 * * * * *'),
      cronTicks: this.ticks,
      dernierTick: this.lastTickAt,
      jobsTraitesParWorker: this.workerRuns,
      dernierTraitement: this.lastWorkerRunAt,
      enfileesDernierTick: this.lastEnqueueCount,
      derniereErreurEnfilage: this.lastEnqueueError,
      file: counts,
    };
  }

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
      facets: search.facets as Record<string, number[]> | null,
    });

    // 2) Filtrage local include/exclude, puis exclusion des vendeurs ignorés.
    const matched = this.matching.filter(rawItems, {
      includeKeywords: search.includeKeywords,
      excludeKeywords: search.excludeKeywords,
    });
    const muted = await this.tracking.getMutedLogins();
    const items = muted.size
      ? matched.filter(
          (item) => !item.sellerLogin || !muted.has(item.sellerLogin),
        )
      : matched;

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

    // 3) Observations de prix (sur le prix effectif acheteur, segmenté par état).
    await this.pricing.recordObservations(
      searchId,
      items.map((item) => ({
        vintedItemId: item.id,
        price: item.totalPrice,
        currency: item.currency,
        modelKey: normalizeModelKey(item.title),
        statusId: item.statusId,
      })),
    );

    // 4) Enrichissement + scoring (comparaison sur le prix effectif et l'état).
    const enriched: EnrichedVintedItem[] = [];
    for (const item of items) {
      const modelKey = normalizeModelKey(item.title);
      const deal = await this.pricing.scoreDeal(
        item.totalPrice,
        modelKey,
        item.statusId,
      );
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
        totalPrice:
          listing.totalPrice != null ? Number(listing.totalPrice) : undefined,
        currency: listing.currency,
        url: listing.url,
        brand: listing.brand ?? undefined,
        size: listing.size ?? undefined,
        condition: listing.condition ?? undefined,
        photoUrl: listing.photoUrl ?? undefined,
        isDeal: listing.isDeal,
        dealScore: listing.dealScore ?? undefined,
        listingId: listing.id,
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
