import { Module } from '@nestjs/common';
import { VintedClient } from './vinted.client';
import { VintedDiscoveryService } from './vinted.discovery';

@Module({
  providers: [VintedClient, VintedDiscoveryService],
  exports: [VintedClient, VintedDiscoveryService],
})
export class VintedModule {}
