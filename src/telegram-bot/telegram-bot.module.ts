import { Module } from '@nestjs/common';
import { SearchesModule } from '../searches/searches.module';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Control-plane Telegram bot module (pilotage), separate from notifications.
 * PrismaService is provided globally, so it does not need to be imported here.
 */
@Module({
  imports: [SearchesModule],
  providers: [TelegramBotService],
})
export class TelegramBotModule {}
