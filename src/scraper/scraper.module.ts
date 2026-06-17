import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { MatchingModule } from '../matching/matching.module';
import { NotifierModule } from '../notifier/notifier.module';
import { PricingModule } from '../pricing/pricing.module';
import { SearchesModule } from '../searches/searches.module';
import { TrackingModule } from '../tracking/tracking.module';
import { VintedModule } from '../vinted/vinted.module';
import { SCRAPE_QUEUE } from './scraper.constants';
import { ScraperProcessor } from './scraper.processor';
import { ScraperScheduler } from './scraper.scheduler';
import { ScraperService } from './scraper.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCRAPE_QUEUE }),
    VintedModule,
    ListingsModule,
    NotifierModule,
    SearchesModule,
    MatchingModule,
    PricingModule,
    TrackingModule,
  ],
  providers: [ScraperScheduler, ScraperProcessor, ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}
