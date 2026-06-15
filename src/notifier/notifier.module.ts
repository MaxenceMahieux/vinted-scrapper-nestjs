import { Module, Provider, Type } from '@nestjs/common';
import { NOTIFICATION_CHANNEL, NotificationChannel } from './channel.interface';
import { TelegramChannel } from './channels/telegram.channel';
import { DiscordChannel } from './channels/discord.channel';
import { NtfyChannel } from './channels/ntfy.channel';
import { EmailChannel } from './channels/email.channel';
import { NotifierService } from './notifier.service';

/** Registers a channel under the shared multi-provider token. */
const channelProvider = (useClass: Type<NotificationChannel>): Provider =>
  ({
    provide: NOTIFICATION_CHANNEL,
    useClass,
    multi: true,
  }) as Provider;

@Module({
  providers: [
    channelProvider(TelegramChannel),
    channelProvider(DiscordChannel),
    channelProvider(NtfyChannel),
    channelProvider(EmailChannel),
    NotifierService,
  ],
  exports: [NotifierService],
})
export class NotifierModule {}
