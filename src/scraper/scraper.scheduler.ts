import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { CronJob } from 'cron';
import { SearchesService } from '../searches/searches.service';
import { SCRAPE_QUEUE, ScrapeJobData } from './scraper.constants';

/**
 * Cron applicatif : à chaque tick, enfile un job de scraping par recherche
 * activée. BullMQ se charge ensuite de l'exécution et des retries.
 *
 * L'expression cron est configurable via SCRAPE_CRON (défaut: toutes les 60s).
 */
@Injectable()
export class ScraperScheduler {
  private readonly logger = new Logger(ScraperScheduler.name);

  constructor(
    @InjectQueue(SCRAPE_QUEUE) private readonly queue: Queue<ScrapeJobData>,
    private readonly searches: SearchesService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {
    const expression = this.config.get<string>('SCRAPE_CRON', '*/60 * * * * *');
    const job = new CronJob(expression, () => this.enqueueAll());
    this.registry.addCronJob('scrape-tick', job);
    job.start();
    this.logger.log(`Scheduler démarré (cron: ${expression})`);
  }

  private async enqueueAll(): Promise<void> {
    const searches = await this.searches.findEnabled();
    if (!searches.length) return;

    await this.queue.addBulk(
      searches.map((s) => ({
        name: 'scrape-search',
        data: { searchId: s.id },
        opts: {
          jobId: `scrape:${s.id}`, // évite les doublons si un tick déborde
          removeOnComplete: true,
          removeOnFail: 50,
        },
      })),
    );
    this.logger.debug(`${searches.length} recherche(s) enfilée(s)`);
  }
}
