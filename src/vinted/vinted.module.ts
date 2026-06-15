import { Module } from '@nestjs/common';
import { VintedClient } from './vinted.client';

@Module({
  providers: [VintedClient],
  exports: [VintedClient],
})
export class VintedModule {}
