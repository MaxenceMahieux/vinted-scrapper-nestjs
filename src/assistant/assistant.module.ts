import { Module } from '@nestjs/common';
import { SearchesModule } from '../searches/searches.module';
import { VintedModule } from '../vinted/vinted.module';
import { AssistantService } from './assistant.service';

@Module({
  imports: [SearchesModule, VintedModule],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
