import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ScraperService } from './scraper.service';
import { SCRAPE_QUEUE, ScrapeJobData } from './scraper.constants';

/**
 * Worker BullMQ : délègue le cycle de scraping d'une recherche à ScraperService.
 * `concurrency: 1` sérialise les appels à Vinted pour rester sous le radar.
 */
@Processor(SCRAPE_QUEUE, { concurrency: 1 })
export class ScraperProcessor extends WorkerHost {
  constructor(private readonly scraper: ScraperService) {
    super();
  }

  async process(job: Job<ScrapeJobData>): Promise<void> {
    await this.scraper.runOnce(job.data.searchId);
  }
}
