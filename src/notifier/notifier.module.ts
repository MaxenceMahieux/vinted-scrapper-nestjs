import { Module } from '@nestjs/common';
import { NOTIFICATION_CHANNEL } from './channel.interface';
import { TelegramChannel } from './channels/telegram.channel';
import { DiscordChannel } from './channels/discord.channel';
import { NtfyChannel } from './channels/ntfy.channel';
import { EmailChannel } from './channels/email.channel';
import { NotifierService } from './notifier.service';

/**
 * NestJS ne supporte PAS les providers `multi: true` (concept Angular) : un
 * @Inject sur un token enregistré plusieurs fois ne renvoie qu'UNE valeur, pas
 * un tableau. On assemble donc explicitement le tableau de canaux via une
 * factory — c'est le pattern correct pour injecter une collection de providers.
 */
@Module({
  providers: [
    TelegramChannel,
    DiscordChannel,
    NtfyChannel,
    EmailChannel,
    {
      provide: NOTIFICATION_CHANNEL,
      useFactory: (
        telegram: TelegramChannel,
        discord: DiscordChannel,
        ntfy: NtfyChannel,
        email: EmailChannel,
      ) => [telegram, discord, ntfy, email],
      inject: [TelegramChannel, DiscordChannel, NtfyChannel, EmailChannel],
    },
    NotifierService,
  ],
  exports: [NotifierService],
})
export class NotifierModule {}
