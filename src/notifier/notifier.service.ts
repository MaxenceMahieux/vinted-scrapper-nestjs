import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Listing } from '@prisma/client';
import axios from 'axios';

/**
 * Envoie les notifications via l'API Bot Telegram.
 *
 * Configuration requise : TELEGRAM_BOT_TOKEN (via @BotFather) et TELEGRAM_CHAT_ID
 * (l'id de la conversation où pousser les alertes).
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
  }

  private get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async notify(searchName: string, listing: Listing): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        `Telegram non configuré, notification ignorée: ${listing.title}`,
      );
      return;
    }

    const text =
      `🔔 <b>${searchName}</b>\n` +
      `${this.escape(listing.title)}\n` +
      `💶 <b>${listing.price} ${listing.currency}</b>` +
      (listing.brand ? ` · ${this.escape(listing.brand)}` : '') +
      (listing.size ? ` · ${this.escape(listing.size)}` : '') +
      `\n${listing.url}`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        },
        { timeout: 10_000 },
      );
    } catch (err) {
      this.logger.error(
        `Échec d'envoi Telegram pour ${listing.url}`,
        (err as Error).message,
      );
    }
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
