import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TrackedItem } from '@prisma/client';
import { NotifierService } from '../notifier/notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { VintedClient } from '../vinted/vinted.client';

/** Données minimales pour démarrer le suivi de prix d'un article. */
export interface TrackInput {
  vintedItemId: number;
  chatId: string;
  title: string;
  url: string;
  photoUrl?: string | null;
  currency: string;
  country: string;
  price: number;
}

/**
 * Gère les préférences de veille de l'utilisateur :
 * - suivi de prix d'articles individuels (alerte en cas de baisse) ;
 * - vendeurs ignorés (leurs annonces ne déclenchent plus de notification).
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vinted: VintedClient,
    private readonly notifier: NotifierService,
  ) {}

  /**
   * Démarre (ou réactive) le suivi de prix d'un article. Idempotent : un
   * article déjà suivi voit simplement son suivi réactivé.
   */
  async track(input: TrackInput): Promise<TrackedItem> {
    const price = new Prisma.Decimal(input.price);
    return this.prisma.trackedItem.upsert({
      where: { vintedItemId: BigInt(input.vintedItemId) },
      create: {
        vintedItemId: BigInt(input.vintedItemId),
        chatId: input.chatId,
        title: input.title,
        url: input.url,
        photoUrl: input.photoUrl ?? undefined,
        currency: input.currency,
        country: input.country,
        initialPrice: price,
        lastPrice: price,
      },
      update: { active: true, chatId: input.chatId },
    });
  }

  /** Arrête le suivi (désactive sans supprimer l'historique). */
  async untrack(id: string): Promise<TrackedItem> {
    return this.prisma.trackedItem.update({
      where: { id },
      data: { active: false },
    });
  }

  /** Liste les articles activement suivis par un chat. */
  listActive(chatId: string): Promise<TrackedItem[]> {
    return this.prisma.trackedItem.findMany({
      where: { chatId, active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Ajoute un vendeur à la liste des ignorés (idempotent). */
  async muteSeller(sellerLogin: string): Promise<void> {
    await this.prisma.mutedSeller.upsert({
      where: { sellerLogin },
      create: { sellerLogin },
      update: {},
    });
  }

  /** Ensemble des logins de vendeurs ignorés (pour filtrer le scraping). */
  async getMutedLogins(): Promise<Set<string>> {
    const rows = await this.prisma.mutedSeller.findMany({
      select: { sellerLogin: true },
    });
    return new Set(rows.map((r) => r.sellerLogin));
  }

  /**
   * Vérifie tous les articles suivis : relève le prix courant, alerte en cas de
   * baisse, et désactive ceux qui ont été vendus/retirés. Le throttle interne du
   * client Vinted s'applique à chaque appel (boucle séquentielle volontaire).
   */
  async checkAll(): Promise<void> {
    const tracked = await this.prisma.trackedItem.findMany({
      where: { active: true },
    });
    if (!tracked.length) return;

    let drops = 0;
    let closed = 0;
    for (const item of tracked) {
      try {
        const detail = await this.vinted.getItem(
          Number(item.vintedItemId),
          item.country,
        );

        if (!detail || !detail.available) {
          await this.prisma.trackedItem.update({
            where: { id: item.id },
            data: { active: false, lastCheckedAt: new Date() },
          });
          closed += 1;
          continue;
        }

        const previous = item.lastPrice.toNumber();
        const current = detail.price;

        if (current < previous) {
          await this.notifier.dispatch(['telegram'], {
            searchName: 'Suivi de prix',
            title: item.title,
            price: current,
            currency: item.currency,
            url: item.url,
            photoUrl: item.photoUrl ?? undefined,
            previousPrice: previous,
            trackedId: item.id,
          });
          drops += 1;
        }

        // Aligne le dernier prix connu (à la hausse comme à la baisse).
        if (current !== previous) {
          await this.prisma.trackedItem.update({
            where: { id: item.id },
            data: {
              lastPrice: new Prisma.Decimal(current),
              lastCheckedAt: new Date(),
            },
          });
        } else {
          await this.prisma.trackedItem.update({
            where: { id: item.id },
            data: { lastCheckedAt: new Date() },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Échec du contrôle de prix pour l'article ${item.vintedItemId}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Suivi de prix : ${tracked.length} article(s) vérifié(s), ${drops} baisse(s), ${closed} clôturé(s)`,
    );
  }
}
