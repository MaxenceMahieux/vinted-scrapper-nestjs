import { Module } from '@nestjs/common';
import { ScraperModule } from '../scraper/scraper.module';
import { SearchesModule } from '../searches/searches.module';
import { VintedModule } from '../vinted/vinted.module';
import { AssistantService } from './assistant.service';

@Module({
  imports: [SearchesModule, VintedModule, ScraperModule],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
