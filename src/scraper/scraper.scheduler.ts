import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { CronJob } from 'cron';
import { SearchesService } from '../searches/searches.service';
import { ScraperService } from './scraper.service';
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
    private readonly scraper: ScraperService,
  ) {
    const expression = this.config.get<string>('SCRAPE_CRON', '*/60 * * * * *');
    const job = new CronJob(expression, () => this.enqueueAll());
    this.registry.addCronJob('scrape-tick', job);
    job.start();
    this.logger.log(`Scheduler démarré (cron: ${expression})`);
  }

  private async enqueueAll(): Promise<void> {
    this.scraper.recordTick();
    try {
      const searches = await this.searches.findEnabled();
      if (!searches.length) {
        this.scraper.recordEnqueue(0);
        this.logger.log('Tick scraping: aucune recherche active');
        return;
      }

      await this.queue.addBulk(
        searches.map((s) => ({
          name: 'scrape-search',
          data: { searchId: s.id },
          opts: {
            // BullMQ interdit le caractère ':' dans un jobId (séparateur Redis
            // interne) -> on utilise '-'. Évite les doublons si un tick déborde.
            jobId: `scrape-${s.id}`,
            removeOnComplete: true,
            // Important: on retire AUSSI les jobs échoués, sinon le jobId
            // resterait occupé par un job "failed" et tous les ticks suivants
            // seraient ignorés (dédup par jobId).
            removeOnFail: true,
          },
        })),
      );
      this.scraper.recordEnqueue(searches.length);
      this.logger.log(
        `Tick scraping: ${searches.length} recherche(s) enfilée(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.scraper.recordEnqueue(-1, message);
      this.logger.error(
        `Échec de l'enfilage des jobs de scraping: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
