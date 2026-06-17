import { Module } from '@nestjs/common';
import { NotifierModule } from '../notifier/notifier.module';
import { VintedModule } from '../vinted/vinted.module';
import { TrackingScheduler } from './tracking.scheduler';
import { TrackingService } from './tracking.service';

/**
 * Veille personnelle : suivi de prix d'articles individuels et vendeurs ignorés.
 * PrismaService est fourni globalement, pas besoin de l'importer ici.
 */
@Module({
  imports: [VintedModule, NotifierModule],
  providers: [TrackingService, TrackingScheduler],
  exports: [TrackingService],
})
export class TrackingModule {}
