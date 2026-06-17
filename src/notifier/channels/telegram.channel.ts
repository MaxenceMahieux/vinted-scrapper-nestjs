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

    // Alerte de baisse : ancien prix barré → nouveau prix.
    const priceLine =
      p.previousPrice !== undefined && p.previousPrice > p.price
        ? `📉 <s>${p.previousPrice} ${p.currency}</s> → <b>${p.price} ${p.currency}</b>`
        : `💶 <b>${p.price} ${p.currency}</b>`;

    // Prix réel payé (protection acheteurs incluse) quand il diffère.
    const totalLine =
      p.totalPrice !== undefined && p.totalPrice > p.price
        ? ` <i>(${p.totalPrice} ${p.currency} avec protection)</i>`
        : '';

    const text =
      `🔔 <b>${this.escape(p.searchName)}</b>\n` +
      dealTag +
      `${this.escape(p.title)}\n` +
      priceLine +
      totalLine +
      (p.brand ? ` · ${this.escape(p.brand)}` : '') +
      (p.size ? ` · ${this.escape(p.size)}` : '') +
      (p.condition ? ` · ${this.escape(p.condition)}` : '') +
      `\n${p.url}`;

    const replyMarkup = this.buildKeyboard(p);

    await axios.post(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      },
      { timeout: 10_000 },
    );
  }

  /**
   * Construit le clavier inline d'actions rapides. Les callbacks sont préfixés
   * (`t:`/`f:`/`m:`/`u:`) et portent l'id concerné ; ils sont traités par le bot
   * de pilotage (long polling) qui partage le même token.
   */
  private buildKeyboard(
    p: NotificationPayload,
  ): { inline_keyboard: TelegramButton[][] } | null {
    const rows: TelegramButton[][] = [[{ text: '🔗 Voir', url: p.url }]];

    if (p.listingId) {
      rows.push([
        { text: '📉 Suivre le prix', callback_data: `t:${p.listingId}` },
        { text: '❤️ Favori', callback_data: `f:${p.listingId}` },
      ]);
      rows.push([
        { text: '🔕 Ignorer ce vendeur', callback_data: `m:${p.listingId}` },
      ]);
    }

    if (p.trackedId) {
      rows.push([{ text: '🛑 Stop suivi', callback_data: `u:${p.trackedId}` }]);
    }

    return rows.length ? { inline_keyboard: rows } : null;
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/** Bouton inline Telegram : soit un lien (url), soit une action (callback_data). */
type TelegramButton =
  | { text: string; url: string }
  | { text: string; callback_data: string };
