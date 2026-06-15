import { Module } from '@nestjs/common';
import { VintedModule } from '../vinted/vinted.module';
import { SearchesController } from './searches.controller';
import { SearchesService } from './searches.service';

@Module({
  imports: [VintedModule],
  controllers: [SearchesController],
  providers: [SearchesService],
  exports: [SearchesService],
})
export class SearchesModule {}
