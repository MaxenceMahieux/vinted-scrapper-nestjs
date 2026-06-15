import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PricingService } from './pricing.service';

/**
 * Cron de recalcul des statistiques de prix. À chaque tick, recalcule
 * l'intégralité des PriceStat à partir de l'historique des observations.
 *
 * L'expression cron est configurable via PRICE_STATS_CRON (défaut : 04h00).
 */
@Injectable()
export class PricingScheduler {
  private readonly logger = new Logger(PricingScheduler.name);

  constructor(
    private readonly pricing: PricingService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {
    const expression = this.config.get<string>('PRICE_STATS_CRON', '0 4 * * *');
    const job = new CronJob(expression, () => this.recompute());
    this.registry.addCronJob('price-stats-tick', job);
    job.start();
    this.logger.log(`Scheduler de stats démarré (cron: ${expression})`);
  }

  private async recompute(): Promise<void> {
    try {
      await this.pricing.recomputeAllStats();
    } catch (err) {
      this.logger.error('Échec du recalcul des statistiques de prix', err);
    }
  }
}
