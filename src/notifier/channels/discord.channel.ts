import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationChannel, NotificationPayload } from '../channel.interface';

/**
 * Sends notifications through a Discord webhook using a rich embed.
 *
 * Required configuration: DISCORD_WEBHOOK_URL.
 */
@Injectable()
export class DiscordChannel implements NotificationChannel {
  readonly key = 'discord';
  private readonly webhookUrl?: string;

  constructor(private readonly config: ConfigService) {
    this.webhookUrl = this.config.get<string>('DISCORD_WEBHOOK_URL');
  }

  isEnabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async send(p: NotificationPayload): Promise<void> {
    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: 'Price', value: `${p.price} ${p.currency}`, inline: true },
    ];
    if (p.brand) fields.push({ name: 'Brand', value: p.brand, inline: true });
    if (p.size) fields.push({ name: 'Size', value: p.size, inline: true });
    if (p.isDeal) {
      fields.push({
        name: 'Deal',
        value:
          p.dealScore !== undefined
            ? `🔥 ${Math.round(p.dealScore * 100)}%`
            : '🔥 Deal',
        inline: true,
      });
    }

    const title = `${p.isDeal ? '🔥 ' : ''}${p.title}`;

    await axios.post(
      this.webhookUrl as string,
      {
        embeds: [
          {
            title: title.slice(0, 256),
            url: p.url,
            description: `🔔 ${p.searchName}`,
            color: p.isDeal ? 0xff4500 : 0x09b1ba,
            fields,
            image: p.photoUrl ? { url: p.photoUrl } : undefined,
          },
        ],
      },
      { timeout: 10_000 },
    );
  }
}
