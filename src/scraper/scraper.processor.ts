import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { SavedSearch } from '@prisma/client';
import { Job } from 'bullmq';
import {
  EnrichedVintedItem,
  ListingsService,
} from '../listings/listings.service';
import { MatchingService } from '../matching/matching.service';
import { NotifierService } from '../notifier/notifier.service';
import { NotificationPayload } from '../notifier/channel.interface';
import { normalizeModelKey } from '../pricing/model-key.util';
import { PricingService } from '../pricing/pricing.service';
import { SearchesService } from '../searches/searches.service';
import { PrismaService } from '../prisma/prisma.service';
import { VintedClient } from '../vinted/vinted.client';
import { SCRAPE_QUEUE, ScrapeJobData } from './scraper.constants';

/**
 * Worker BullMQ : pour une recherche donnée, interroge Vinted avec tous ses
 * filtres, applique le filtrage local par mots-clés, enregistre les
 * observations de prix, score les affaires, persiste les nouveaux items (dédup)
 * et notifie ceux qui doivent l'être.
 *
 * `concurrency: 1` sérialise les appels à Vinted pour rester sous le radar.
 */
@Processor(SCRAPE_QUEUE, { concurrency: 1 })
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vinted: VintedClient,
    private readonly listings: ListingsService,
    private readonly notifier: NotifierService,
    private readonly searches: SearchesService,
    private readonly matching: MatchingService,
    private readonly pricing: PricingService,
  ) {
    super();
  }

  async process(job: Job<ScrapeJobData>): Promise<void> {
    const { searchId } = job.data;
    const search = await this.prisma.savedSearch.findUnique({
      where: { id: searchId },
    });
    if (!search || !search.enabled) return;

    // 1) Fetch Vinted avec tous les filtres de la recherche.
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

    // 2) Filtrage local include/exclude keywords.
    const items = this.matching.filter(rawItems, {
      includeKeywords: search.includeKeywords,
      excludeKeywords: search.excludeKeywords,
    });

    if (!items.length) {
      await this.searches.markRun(searchId);
      return;
    }

    // 3) Enregistre les observations de prix (clé de modèle normalisée).
    await this.pricing.recordObservations(
      searchId,
      items.map((item) => ({
        vintedItemId: item.id,
        price: item.price,
        currency: item.currency,
        modelKey: normalizeModelKey(item.title),
      })),
    );

    // 4) Enrichit chaque item (modelKey + scoring deal).
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

    // 5) Persiste et récupère uniquement les nouveaux items.
    const fresh = await this.listings.saveNew(searchId, enriched);
    await this.searches.markRun(searchId);

    if (!fresh.length) return;

    // 6) Sélection des items à notifier (filtre dealOnly / minDealScore).
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
  }

  /**
   * Détermine si une annonce doit être notifiée selon la politique de la
   * recherche : si `dealOnly`, seules les affaires (et au-dessus du seuil
   * `minDealScore` éventuel) sont notifiées.
   */
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
