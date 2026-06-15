import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { NotifierModule } from '../notifier/notifier.module';
import { SearchesModule } from '../searches/searches.module';
import { VintedModule } from '../vinted/vinted.module';
import { SCRAPE_QUEUE } from './scraper.constants';
import { ScraperProcessor } from './scraper.processor';
import { ScraperScheduler } from './scraper.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCRAPE_QUEUE }),
    VintedModule,
    ListingsModule,
    NotifierModule,
    SearchesModule,
  ],
  providers: [ScraperScheduler, ScraperProcessor],
})
export class ScraperModule {}
