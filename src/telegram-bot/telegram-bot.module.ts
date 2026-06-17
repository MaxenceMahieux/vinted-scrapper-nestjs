import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module';
import { ListingsModule } from '../listings/listings.module';
import { SearchesModule } from '../searches/searches.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Control-plane Telegram bot module (pilotage), separate from notifications.
 * PrismaService is provided globally, so it does not need to be imported here.
 */
@Module({
  imports: [SearchesModule, AssistantModule, ListingsModule, TrackingModule],
  providers: [TelegramBotService],
})
export class TelegramBotModule {}
