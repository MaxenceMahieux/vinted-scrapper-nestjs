import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSearchDto } from '../searches/dto/create-search.dto';
import { UpdateSearchDto } from '../searches/dto/update-search.dto';
import { ScraperService } from '../scraper/scraper.service';
import { SearchesService } from '../searches/searches.service';
import { VintedClient } from '../vinted/vinted.client';
import { VintedDiscoveryService } from '../vinted/vinted.discovery';
import { ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS } from './assistant.tools';

/** Tour de conversation conservé entre messages (texte uniquement). */
interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Assistant en langage naturel basé sur l'API Claude.
 *
 * Reçoit un message texte de l'utilisateur (via Telegram) et, par tool use,
 * exécute les opérations de l'app (créer/lister/modifier/supprimer une
 * recherche, résoudre des marques/catégories Vinted). Renvoie une réponse en
 * français à afficher.
 *
 * Désactivé tant que ANTHROPIC_API_KEY n'est pas configuré.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly client?: Anthropic;
  private readonly model: string;
  private readonly histories = new Map<string, ChatTurn[]>();

  private static readonly MAX_ITERATIONS = 6;
  private static readonly MAX_HISTORY_TURNS = 20;

  constructor(
    private readonly config: ConfigService,
    private readonly searches: SearchesService,
    private readonly discovery: VintedDiscoveryService,
    private readonly prisma: PrismaService,
    private readonly vinted: VintedClient,
    private readonly scraper: ScraperService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.model = this.config.get<string>('ANTHROPIC_MODEL', 'claude-opus-4-8');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  isEnabled(): boolean {
    return Boolean(this.client);
  }

  /**
   * Traite un message utilisateur dans le contexte d'une conversation (chatId)
   * et renvoie la réponse en langage naturel.
   */
  async chat(chatId: string, userText: string): Promise<string> {
    if (!this.client) {
      throw new Error('Assistant désactivé (ANTHROPIC_API_KEY manquant)');
    }

    const history = this.histories.get(chatId) ?? [];
    const messages: Anthropic.MessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: userText },
    ];

    let finalText = '';

    for (let i = 0; i < AssistantService.MAX_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: ASSISTANT_SYSTEM_PROMPT,
        tools: ASSISTANT_TOOLS,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) finalText = text;

      if (response.stop_reason !== 'tool_use') break;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUses) {
        const result = await this.runTool(tool.name, tool.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const reply = finalText || 'OK.';
    this.remember(chatId, history, userText, reply);
    return reply;
  }

  private remember(
    chatId: string,
    history: ChatTurn[],
    userText: string,
    reply: string,
  ): void {
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: reply });
    // Conserve les N derniers tours (paires user/assistant).
    const max = AssistantService.MAX_HISTORY_TURNS * 2;
    if (history.length > max) history.splice(0, history.length - max);
    this.histories.set(chatId, history);
  }

  /** Exécute un outil et renvoie son résultat sérialisé pour Claude. */
  private async runTool(
    name: string,
    input: unknown,
  ): Promise<{ content: string; isError: boolean }> {
    const args = (input ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'create_search': {
          const created = await this.searches.create(
            args as unknown as CreateSearchDto,
          );
          return this.ok({ id: created.id, name: created.name });
        }
        case 'list_searches': {
          const all = await this.searches.findAll();
          return this.ok(
            all.map((s) => ({
              id: s.id,
              name: s.name,
              enabled: s.enabled,
              searchText: s.searchText,
              priceFrom: s.priceFrom,
              priceTo: s.priceTo,
            })),
          );
        }
        case 'update_search': {
          const { id, ...rest } = args as unknown as {
            id: string;
          } & UpdateSearchDto;
          const updated = await this.searches.update(id, rest);
          return this.ok({
            id: updated.id,
            name: updated.name,
            enabled: updated.enabled,
          });
        }
        case 'delete_search': {
          const removed = await this.searches.remove(this.str(args.id) ?? '');
          return this.ok({ deleted: removed.name });
        }
        case 'test_search': {
          const search = await this.prisma.savedSearch.findUnique({
            where: { id: this.str(args.id) ?? '' },
          });
          if (!search) {
            return { content: 'Recherche introuvable.', isError: true };
          }
          const diag = await this.vinted.selfTest({
            searchText: search.searchText,
            catalogIds: search.catalogIds,
            brandIds: search.brandIds,
            statusIds: search.statusIds,
            sizeIds: search.sizeIds,
            priceFrom: search.priceFrom ? Number(search.priceFrom) : null,
            priceTo: search.priceTo ? Number(search.priceTo) : null,
            order: search.order,
            country: search.country,
          });
          return this.ok({
            vintedOk: diag.apiStatus === 200,
            proxyActif: diag.proxy,
            statutAccueil: diag.homeStatus,
            tokenRecupere: diag.tokenCaptured,
            statutApi: diag.apiStatus,
            annoncesRecuperees: diag.fetched,
            cookies: diag.cookieNames,
          });
        }
        case 'scrape_status': {
          return this.ok(await this.scraper.getDiagnostics());
        }
        case 'run_search_now': {
          const result = await this.scraper.runOnce(this.str(args.id) ?? '');
          return this.ok({
            recherche: result.searchName,
            active: result.enabled,
            annoncesRecuperees: result.fetched,
            apresFiltres: result.matched,
            nouvelles: result.fresh,
            notifiees: result.notified,
          });
        }
        case 'search_brands': {
          const brands = await this.discovery.searchBrands(
            this.str(args.name) ?? '',
            this.str(args.country),
          );
          return this.ok(brands.slice(0, 20));
        }
        case 'search_catalogs': {
          const catalogs = await this.discovery.getCatalogs(
            this.str(args.country),
          );
          return this.ok(catalogs);
        }
        default:
          return { content: `Outil inconnu: ${name}`, isError: true };
      }
    } catch (err) {
      const message =
        (err as { code?: string }).code === 'P2025'
          ? 'Aucune recherche trouvée avec cet id.'
          : err instanceof Error
            ? err.message
            : 'Erreur inconnue';
      this.logger.warn(`Échec de l'outil ${name}: ${message}`);
      return { content: message, isError: true };
    }
  }

  private ok(data: unknown): { content: string; isError: boolean } {
    return { content: JSON.stringify(data), isError: false };
  }

  /** Coerce une valeur d'argument en string optionnelle (sécurise le typage). */
  private str(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
