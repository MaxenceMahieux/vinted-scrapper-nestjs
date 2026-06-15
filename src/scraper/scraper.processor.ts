import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ListingsService } from '../listings/listings.service';
import { NotifierService } from '../notifier/notifier.service';
import { SearchesService } from '../searches/searches.service';
import { PrismaService } from '../prisma/prisma.service';
import { VintedClient } from '../vinted/vinted.client';
import { SCRAPE_QUEUE, ScrapeJobData } from './scraper.constants';

/**
 * Worker BullMQ : pour une recherche donnée, interroge Vinted, persiste les
 * nouveaux items (dédup) et notifie chacun d'eux.
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
  ) {
    super();
  }

  async process(job: Job<ScrapeJobData>): Promise<void> {
    const { searchId } = job.data;
    const search = await this.prisma.savedSearch.findUnique({
      where: { id: searchId },
    });
    if (!search || !search.enabled) return;

    const items = await this.vinted.searchCatalog({
      searchText: search.searchText,
      catalogIds: search.catalogIds,
      brandIds: search.brandIds,
      priceFrom: search.priceFrom ? Number(search.priceFrom) : null,
      priceTo: search.priceTo ? Number(search.priceTo) : null,
      order: search.order,
    });

    const fresh = await this.listings.saveNew(searchId, items);
    await this.searches.markRun(searchId);

    if (fresh.length) {
      this.logger.log(`${fresh.length} nouvelle(s) annonce(s) — ${search.name}`);
      for (const listing of fresh) {
        await this.notifier.notify(search.name, listing);
      }
      await this.listings.markNotified(fresh.map((l) => l.id));
    }
  }
}
