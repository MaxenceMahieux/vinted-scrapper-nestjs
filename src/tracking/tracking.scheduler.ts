import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TrackingService } from './tracking.service';

/**
 * Cron de contrôle des articles suivis : relève les prix courants pour alerter
 * en cas de baisse. Expression configurable via PRICE_TRACK_CRON (défaut : toutes
 * les 30 minutes). Vide → suivi désactivé.
 */
@Injectable()
export class TrackingScheduler {
  private readonly logger = new Logger(TrackingScheduler.name);

  constructor(
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {
    const expression = this.config.get<string>(
      'PRICE_TRACK_CRON',
      '0 */30 * * * *',
    );
    if (!expression) {
      this.logger.warn('Suivi de prix désactivé (PRICE_TRACK_CRON vide)');
      return;
    }
    const job = new CronJob(expression, () => this.check());
    this.registry.addCronJob('price-track-tick', job);
    job.start();
    this.logger.log(`Scheduler de suivi de prix démarré (cron: ${expression})`);
  }

  private async check(): Promise<void> {
    try {
      await this.tracking.checkAll();
    } catch (err) {
      this.logger.error('Échec du contrôle des articles suivis', err);
    }
  }
}
