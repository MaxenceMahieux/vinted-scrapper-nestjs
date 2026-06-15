import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ListingsModule } from './listings/listings.module';
import { NotifierModule } from './notifier/notifier.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScraperModule } from './scraper/scraper.module';
import { SearchesModule } from './searches/searches.module';
import { VintedModule } from './vinted/vinted.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    PrismaModule,
    VintedModule,
    SearchesModule,
    ListingsModule,
    NotifierModule,
    ScraperModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
