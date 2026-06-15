import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationChannel, NotificationPayload } from '../channel.interface';

/**
 * Sends notifications through the Telegram Bot API (sendMessage, HTML mode).
 *
 * Required configuration: TELEGRAM_BOT_TOKEN (via @BotFather) and
 * TELEGRAM_CHAT_ID (the conversation id where alerts are pushed).
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly key = 'telegram';
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
  }

  isEnabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async send(p: NotificationPayload): Promise<void> {
    const dealTag = p.isDeal
      ? `🔥 <b>DEAL${p.dealScore !== undefined ? ` ${Math.round(p.dealScore * 100)}%` : ''}</b>\n`
      : '';

    const text =
      `🔔 <b>${this.escape(p.searchName)}</b>\n` +
      dealTag +
      `${this.escape(p.title)}\n` +
      `💶 <b>${p.price} ${p.currency}</b>` +
      (p.brand ? ` · ${this.escape(p.brand)}` : '') +
      (p.size ? ` · ${this.escape(p.size)}` : '') +
      `\n${p.url}`;

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
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
