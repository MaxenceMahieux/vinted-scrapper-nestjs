import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { AssistantService } from '../assistant/assistant.service';
import { ListingsService } from '../listings/listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { SearchesService } from '../searches/searches.service';
import { CreateSearchDto } from '../searches/dto/create-search.dto';
import { TrackingService } from '../tracking/tracking.service';

/**
 * Telegram control-plane bot (pilotage), separate from the notification channel.
 *
 * It lets the owner manage saved searches over Telegram via long polling.
 * Only starts when TELEGRAM_BOT_TOKEN is set; otherwise it stays disabled.
 * When TELEGRAM_CHAT_ID is set, messages from any other chat are ignored.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly token?: string;
  private readonly allowedChatId?: string;
  private bot?: Telegraf;

  constructor(
    private readonly config: ConfigService,
    private readonly searches: SearchesService,
    private readonly prisma: PrismaService,
    private readonly assistant: AssistantService,
    private readonly listings: ListingsService,
    private readonly tracking: TrackingService,
  ) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.allowedChatId = this.config.get<string>('TELEGRAM_CHAT_ID');
  }

  onModuleInit(): void {
    if (!this.token) {
      this.logger.warn('Control-plane bot disabled (no TELEGRAM_BOT_TOKEN)');
      return;
    }

    const bot = new Telegraf(this.token);
    this.bot = bot;

    // Restrict every update to the allowed chat when configured.
    bot.use(async (ctx, next) => {
      if (this.allowedChatId) {
        const chatId = ctx.chat?.id?.toString();
        if (chatId !== this.allowedChatId) {
          return;
        }
      }
      await next();
    });

    bot.start((ctx) => ctx.reply(this.helpText()));
    bot.help((ctx) => ctx.reply(this.helpText()));
    bot.command('list', (ctx) => this.handleList(ctx));
    bot.command('add', (ctx) => this.handleAdd(ctx));
    bot.command('pause', (ctx) => this.handlePause(ctx));
    bot.command('resume', (ctx) => this.handleResume(ctx));
    bot.command('delete', (ctx) => this.handleDelete(ctx));
    bot.command('tracked', (ctx) => this.handleTracked(ctx));

    // Boutons inline des notifications (achat 1-clic / veille).
    bot.action(/^t:(.+)$/, (ctx) => this.handleTrack(ctx));
    bot.action(/^f:(.+)$/, (ctx) => this.handleFavorite(ctx));
    bot.action(/^m:(.+)$/, (ctx) => this.handleMute(ctx));
    bot.action(/^u:(.+)$/, (ctx) => this.handleUntrack(ctx));

    // Tout message texte non-commande est routé vers l'assistant IA.
    bot.on(message('text'), (ctx) => this.handleText(ctx));

    bot.catch((err, ctx) => {
      this.logger.error(
        `Unhandled error for update ${ctx.updateType}`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    // Long polling. launch() resolves only when the bot stops, so we do not await it.
    bot
      .launch()
      .catch((err) =>
        this.logger.error(
          'Control-plane bot stopped unexpectedly',
          err instanceof Error ? err.stack : String(err),
        ),
      );

    this.logger.log('Control-plane bot started (long polling)');
  }

  onModuleDestroy(): void {
    if (this.bot) {
      this.bot.stop('SIGTERM');
      this.logger.log('Control-plane bot stopped');
    }
  }

  /**
   * Route un message texte libre vers l'assistant IA. Les commandes inconnues
   * (commençant par /) renvoient l'aide ; sinon Claude traite la demande.
   */
  private async handleText(ctx: TextContext): Promise<void> {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      await ctx.reply(this.helpText());
      return;
    }
    if (!this.assistant.isEnabled()) {
      await ctx.reply(
        'Assistant IA désactivé (ANTHROPIC_API_KEY manquant). Utilise /add, /list, /pause, /resume, /delete.',
      );
      return;
    }

    const chatId = ctx.chat.id.toString();
    try {
      await ctx.sendChatAction('typing');
      const reply = await this.assistant.chat(chatId, text);
      await ctx.reply(reply.slice(0, 4000));
    } catch (err) {
      await this.replyError(ctx, "L'assistant a rencontré une erreur", err);
    }
  }

  private helpText(): string {
    return [
      'Vinted Scrapper - control plane',
      '',
      '/help - show this help',
      '/list - list saved searches',
      '/add <json> - create a search from inline JSON (name + filters)',
      '/pause <id> - disable a search',
      '/resume <id> - enable a search',
      '/delete <id> - delete a search',
      '/tracked - list items whose price you follow',
      '',
      'Sous chaque alerte : 🔗 Voir · 📉 Suivre le prix · ❤️ Favori · 🔕 Ignorer le vendeur',
      '',
      'Ou écris simplement en français ce que tu veux suivre,',
      "l'assistant IA s'occupe du reste. Ex. :",
      '"alerte-moi sur les montres Seiko entre 150 et 400€ sans répliques"',
    ].join('\n');
  }

  private async handleList(ctx: TextContext): Promise<void> {
    try {
      const searches = await this.searches.findAll();
      if (searches.length === 0) {
        await ctx.reply('No saved searches yet. Use /add to create one.');
        return;
      }
      const lines = searches.map((s) => {
        const state = s.enabled ? 'enabled' : 'paused';
        return `- ${s.name} [${state}]\n  id: ${s.id}`;
      });
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      await this.replyError(ctx, 'Failed to list searches', err);
    }
  }

  private async handleAdd(ctx: TextContext): Promise<void> {
    const json = this.extractArgs(ctx.message.text);
    if (!json) {
      await ctx.reply('Usage: /add <json>\nExample: /add {"name":"Nike"}');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      await ctx.reply('Invalid JSON. Please provide a valid JSON object.');
      return;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      await ctx.reply('Invalid input: expected a JSON object.');
      return;
    }

    const dto = parsed as CreateSearchDto;
    if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      await ctx.reply(
        'Invalid input: "name" is required and must be a string.',
      );
      return;
    }

    try {
      const created = await this.searches.create(dto);
      await ctx.reply(`Created search "${created.name}"\nid: ${created.id}`);
    } catch (err) {
      await this.replyError(ctx, 'Failed to create search', err);
    }
  }

  private async handlePause(ctx: TextContext): Promise<void> {
    await this.setEnabled(ctx, false);
  }

  private async handleResume(ctx: TextContext): Promise<void> {
    await this.setEnabled(ctx, true);
  }

  private async setEnabled(ctx: TextContext, enabled: boolean): Promise<void> {
    const id = this.extractArgs(ctx.message.text);
    const action = enabled ? 'resume' : 'pause';
    if (!id) {
      await ctx.reply(`Usage: /${action} <id>`);
      return;
    }

    try {
      // pause/resume are not on SearchesService, so we use PrismaService directly.
      const updated = await this.prisma.savedSearch.update({
        where: { id },
        data: { enabled },
      });
      const state = updated.enabled ? 'enabled' : 'paused';
      await ctx.reply(`Search "${updated.name}" is now ${state}.`);
    } catch (err) {
      await this.replyNotFoundOrError(
        ctx,
        id,
        `Failed to ${action} search`,
        err,
      );
    }
  }

  private async handleDelete(ctx: TextContext): Promise<void> {
    const id = this.extractArgs(ctx.message.text);
    if (!id) {
      await ctx.reply('Usage: /delete <id>');
      return;
    }

    try {
      const removed = await this.searches.remove(id);
      await ctx.reply(`Deleted search "${removed.name}".`);
    } catch (err) {
      await this.replyNotFoundOrError(ctx, id, 'Failed to delete search', err);
    }
  }

  private async handleTracked(ctx: TextContext): Promise<void> {
    try {
      const chatId = ctx.chat.id.toString();
      const tracked = await this.tracking.listActive(chatId);
      if (tracked.length === 0) {
        await ctx.reply(
          'Aucun article suivi. Touche « 📉 Suivre le prix » sous une alerte.',
        );
        return;
      }
      const lines = tracked.map(
        (t) =>
          `- ${t.title}\n  ${Number(t.lastPrice)} ${t.currency} · ${t.url}`,
      );
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      await this.replyError(ctx, 'Failed to list tracked items', err);
    }
  }

  /** Bouton « 📉 Suivre le prix » : démarre le suivi de l'annonce. */
  private async handleTrack(ctx: CallbackContext): Promise<void> {
    try {
      const listing = await this.listings.findByIdWithSearch(ctx.match[1]);
      if (!listing) {
        await ctx.answerCbQuery('Annonce introuvable');
        return;
      }
      const chatId = (ctx.chat?.id ?? ctx.from?.id)?.toString();
      if (!chatId) {
        await ctx.answerCbQuery('Chat inconnu');
        return;
      }
      await this.tracking.track({
        vintedItemId: Number(listing.vintedItemId),
        chatId,
        title: listing.title,
        url: listing.url,
        photoUrl: listing.photoUrl,
        currency: listing.currency,
        country: listing.search.country,
        price: Number(listing.totalPrice ?? listing.price),
      });
      await ctx.answerCbQuery('📉 Suivi du prix activé');
    } catch (err) {
      await this.answerError(ctx, 'Failed to track item', err);
    }
  }

  /** Bouton « ❤️ Favori » : marque l'annonce comme favorite. */
  private async handleFavorite(ctx: CallbackContext): Promise<void> {
    try {
      await this.listings.setFavorite(ctx.match[1], true);
      await ctx.answerCbQuery('❤️ Ajouté aux favoris');
    } catch (err) {
      await this.answerError(ctx, 'Failed to favorite listing', err);
    }
  }

  /** Bouton « 🔕 Ignorer ce vendeur » : coupe les futures alertes du vendeur. */
  private async handleMute(ctx: CallbackContext): Promise<void> {
    try {
      const listing = await this.listings.findByIdWithSearch(ctx.match[1]);
      if (!listing?.sellerLogin) {
        await ctx.answerCbQuery('Vendeur inconnu');
        return;
      }
      await this.tracking.muteSeller(listing.sellerLogin);
      await ctx.answerCbQuery(`🔕 ${listing.sellerLogin} ignoré`);
    } catch (err) {
      await this.answerError(ctx, 'Failed to mute seller', err);
    }
  }

  /** Bouton « 🛑 Stop suivi » : arrête le suivi de prix. */
  private async handleUntrack(ctx: CallbackContext): Promise<void> {
    try {
      await this.tracking.untrack(ctx.match[1]);
      await ctx.answerCbQuery('🛑 Suivi arrêté');
    } catch (err) {
      await this.answerError(ctx, 'Failed to untrack item', err);
    }
  }

  private async answerError(
    ctx: CallbackContext,
    fallback: string,
    err: unknown,
  ): Promise<void> {
    this.logger.error(fallback, err instanceof Error ? err.stack : String(err));
    await ctx.answerCbQuery('Une erreur est survenue.');
  }

  /** Returns the text after the command, or undefined when empty. */
  private extractArgs(text: string): string | undefined {
    const trimmed = text.trim();
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      return undefined;
    }
    const args = trimmed.slice(spaceIdx + 1).trim();
    return args.length > 0 ? args : undefined;
  }

  private async replyNotFoundOrError(
    ctx: TextContext,
    id: string,
    fallback: string,
    err: unknown,
  ): Promise<void> {
    // Prisma raises P2025 when the target record does not exist.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      err.code === 'P2025'
    ) {
      await ctx.reply(`No search found with id: ${id}`);
      return;
    }
    await this.replyError(ctx, fallback, err);
  }

  private async replyError(
    ctx: TextContext,
    fallback: string,
    err: unknown,
  ): Promise<void> {
    this.logger.error(fallback, err instanceof Error ? err.stack : String(err));
    await ctx.reply(`${fallback}. Please try again.`);
  }
}

/** Telegraf context narrowed to a text command message. */
type TextContext = Context<Update.MessageUpdate> & {
  message: { text: string };
};

/** Telegraf context d'un clic sur bouton inline (action regex). */
type CallbackContext = Context<Update.CallbackQueryUpdate> & {
  match: RegExpExecArray;
};
