import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { NotificationChannel, NotificationPayload } from '../channel.interface';

/**
 * Sends notifications through SMTP using nodemailer.
 *
 * Required configuration: SMTP_HOST, SMTP_PORT, EMAIL_FROM and EMAIL_TO.
 * Optional: SMTP_USER, SMTP_PASS, SMTP_SECURE ("true"/"false").
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly key = 'email';
  private readonly host?: string;
  private readonly port: number;
  private readonly secure: boolean;
  private readonly user?: string;
  private readonly pass?: string;
  private readonly from?: string;
  private readonly to?: string;
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {
    this.host = this.config.get<string>('SMTP_HOST');
    this.port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    this.secure = this.config.get<string>('SMTP_SECURE') === 'true';
    this.user = this.config.get<string>('SMTP_USER');
    this.pass = this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('EMAIL_FROM');
    this.to = this.config.get<string>('EMAIL_TO');
  }

  isEnabled(): boolean {
    return Boolean(this.host && this.from && this.to);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        auth:
          this.user && this.pass
            ? { user: this.user, pass: this.pass }
            : undefined,
      });
    }
    return this.transporter;
  }

  async send(p: NotificationPayload): Promise<void> {
    const dealBadge = p.isDeal
      ? ` 🔥 DEAL${p.dealScore !== undefined ? ` ${Math.round(p.dealScore * 100)}%` : ''}`
      : '';

    const subject = `[Vinted] ${p.searchName}${dealBadge}: ${p.title}`;

    const meta = [`<strong>${p.price} ${p.currency}</strong>`, p.brand, p.size]
      .filter(Boolean)
      .join(' · ');

    const html =
      `<h2>🔔 ${this.escape(p.searchName)}${dealBadge}</h2>` +
      `<p>${this.escape(p.title)}</p>` +
      `<p>${meta}</p>` +
      (p.photoUrl
        ? `<p><img src="${p.photoUrl}" alt="" style="max-width:320px"/></p>`
        : '') +
      `<p><a href="${p.url}">${p.url}</a></p>`;

    await this.getTransporter().sendMail({
      from: this.from,
      to: this.to,
      subject,
      html,
    });
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
