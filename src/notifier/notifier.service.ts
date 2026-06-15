import { Inject, Injectable, Logger } from '@nestjs/common';
import { Listing } from '@prisma/client';
import {
  NOTIFICATION_CHANNEL,
  NotificationChannel,
  NotificationPayload,
} from './channel.interface';

/**
 * Result of a dispatch: which channels succeeded, failed or were skipped.
 */
export interface DispatchSummary {
  attempted: number;
  succeeded: string[];
  failed: string[];
  skipped: string[];
}

/**
 * Fans out a notification to every registered channel whose key is requested
 * by the saved search and that is currently enabled. A failure on one channel
 * never prevents the others from being delivered.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    @Inject(NOTIFICATION_CHANNEL)
    private readonly channels: NotificationChannel[],
  ) {}

  /**
   * Dispatch a payload to the requested channels.
   *
   * @param searchChannels channel keys enabled on the saved search
   * @param payload the notification content
   */
  async dispatch(
    searchChannels: string[],
    payload: NotificationPayload,
  ): Promise<DispatchSummary> {
    const summary: DispatchSummary = {
      attempted: 0,
      succeeded: [],
      failed: [],
      skipped: [],
    };

    const requested = new Set(searchChannels);

    for (const channel of this.channels) {
      if (!requested.has(channel.key)) {
        continue;
      }

      if (!channel.isEnabled()) {
        summary.skipped.push(channel.key);
        this.logger.warn(
          `Channel "${channel.key}" requested but not configured, skipping: ${payload.title}`,
        );
        continue;
      }

      summary.attempted += 1;
      try {
        await channel.send(payload);
        summary.succeeded.push(channel.key);
      } catch (err) {
        summary.failed.push(channel.key);
        this.logger.error(
          `Failed to send via "${channel.key}" for ${payload.url}`,
          (err as Error).message,
        );
      }
    }

    if (summary.attempted === 0 && summary.skipped.length === 0) {
      this.logger.warn(
        `No matching channel for [${searchChannels.join(', ')}], notification ignored: ${payload.title}`,
      );
    }

    return summary;
  }

  /**
   * Legacy helper kept for callers still passing a Prisma {@link Listing}.
   * Builds a {@link NotificationPayload} and delegates to {@link dispatch}.
   */
  async notify(
    searchName: string,
    listing: Listing,
    channels: string[] = ['telegram'],
  ): Promise<DispatchSummary> {
    const payload: NotificationPayload = {
      searchName,
      title: listing.title,
      price: Number(listing.price),
      currency: listing.currency,
      url: listing.url,
      brand: listing.brand ?? undefined,
      size: listing.size ?? undefined,
      photoUrl: listing.photoUrl ?? undefined,
      isDeal: listing.isDeal,
      dealScore: listing.dealScore ?? undefined,
    };
    return this.dispatch(channels, payload);
  }
}
