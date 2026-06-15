import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingScheduler } from './pricing.scheduler';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule],
  providers: [PricingService, PricingScheduler],
  exports: [PricingService],
})
export class PricingModule {}
