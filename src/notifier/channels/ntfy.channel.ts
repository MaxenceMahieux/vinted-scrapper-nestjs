import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NotificationChannel, NotificationPayload } from '../channel.interface';

/**
 * Sends notifications through an ntfy.sh server (or self-hosted instance).
 *
 * Required configuration: NTFY_BASE_URL and NTFY_TOPIC. Optional NTFY_TOKEN
 * for protected instances (sent as a Bearer token).
 */
@Injectable()
export class NtfyChannel implements NotificationChannel {
  readonly key = 'ntfy';
  private readonly baseUrl?: string;
  private readonly topic?: string;
  private readonly token?: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('NTFY_BASE_URL');
    this.topic = this.config.get<string>('NTFY_TOPIC');
    this.token = this.config.get<string>('NTFY_TOKEN');
  }

  isEnabled(): boolean {
    return Boolean(this.baseUrl && this.topic);
  }

  async send(p: NotificationPayload): Promise<void> {
    const url = `${(this.baseUrl as string).replace(/\/+$/, '')}/${this.topic}`;

    const titleParts = [p.searchName];
    if (p.brand) titleParts.push(p.brand);
    if (p.size) titleParts.push(p.size);

    const body =
      `${p.title}\n${p.price} ${p.currency}` +
      (p.isDeal
        ? `\n🔥 Deal${p.dealScore !== undefined ? ` ${Math.round(p.dealScore * 100)}%` : ''}`
        : '');

    const tags = ['shopping_cart'];
    if (p.isDeal) tags.push('fire');

    const headers: Record<string, string> = {
      Title: this.encodeHeader(titleParts.join(' · ')),
      Click: p.url,
      Tags: tags.join(','),
    };
    if (p.photoUrl) headers.Attach = p.photoUrl;
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    await axios.post(url, body, { headers, timeout: 10_000 });
  }

  /**
   * ntfy headers must be ASCII; encode non-latin characters to keep the
   * request valid.
   */
  private encodeHeader(value: string): string {
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7F]*$/.test(value)
      ? value
      : `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
  }
}
