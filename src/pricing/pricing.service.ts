import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PriceStat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Une observation de prix à enregistrer pour un modèle donné. */
export interface ObservationInput {
  vintedItemId: number;
  price: number;
  currency: string;
  modelKey: string;
}

/** Résultat du scoring d'une annonce face à l'historique de son modèle. */
export interface DealScore {
  /** Score normalisé dans [0, 1] : plus c'est haut, meilleure est l'affaire. */
  score: number;
  /** Vrai si l'annonce est considérée comme une bonne affaire. */
  isDeal: boolean;
  /** Économie estimée en valeur (médiane − prix), bornée à 0. */
  savings: number;
  /** Prix de référence (médiane) ou null si pas de statistique fiable. */
  ref: number | null;
}

/**
 * Ratio en dessous duquel une annonce est considérée comme une affaire.
 * price < 70 % de la médiane → deal.
 */
const DEAL_RATIO_THRESHOLD = 0.7;

/**
 * Nombre minimal d'observations pour qu'une statistique soit jugée fiable
 * (en deçà, on ne déclenche jamais de deal).
 */
const MIN_SAMPLES_FOR_DEAL = 5;

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enregistre une série d'observations de prix. Les doublons éventuels ne
   * sont pas dédupliqués ici : chaque passage de scraping contribue à
   * l'historique du modèle.
   */
  async recordObservations(
    searchId: string,
    items: ObservationInput[],
  ): Promise<void> {
    if (!items.length) return;

    await this.prisma.priceObservation.createMany({
      data: items.map((item) => ({
        searchId,
        vintedItemId: BigInt(item.vintedItemId),
        modelKey: item.modelKey,
        price: new Prisma.Decimal(item.price),
        currency: item.currency,
      })),
    });

    this.logger.debug(
      `${items.length} observation(s) enregistrée(s) pour la recherche ${searchId}`,
    );
  }

  /** Renvoie la statistique de prix d'un modèle, ou null si absente. */
  getStat(modelKey: string): Promise<PriceStat | null> {
    return this.prisma.priceStat.findUnique({ where: { modelKey } });
  }

  /**
   * Évalue le prix d'une annonce face à la médiane de son modèle.
   *
   * - ratio = price / median
   * - score = clamp(1 − ratio, 0, 1)
   * - isDeal = ratio < 0.7 ET au moins MIN_SAMPLES_FOR_DEAL observations
   *
   * En l'absence de statistique exploitable, renvoie un score nul et ref null.
   */
  async scoreDeal(price: number, modelKey: string): Promise<DealScore> {
    const stat = await this.getStat(modelKey);

    if (!stat) {
      return { score: 0, isDeal: false, savings: 0, ref: null };
    }

    const median = stat.median.toNumber();
    if (median <= 0) {
      return { score: 0, isDeal: false, savings: 0, ref: median };
    }

    const ratio = price / median;
    const score = clamp(1 - ratio, 0, 1);
    const isDeal =
      ratio < DEAL_RATIO_THRESHOLD && stat.samples >= MIN_SAMPLES_FOR_DEAL;
    const savings = Math.max(median - price, 0);

    return { score, isDeal, savings, ref: median };
  }

  /**
   * Recalcule toutes les statistiques de prix (médiane, 25e percentile,
   * nombre d'échantillons) par modèle à partir des observations, puis les
   * persiste via upsert. Les percentiles sont calculés en TypeScript pur.
   */
  async recomputeAllStats(): Promise<void> {
    const observations = await this.prisma.priceObservation.findMany({
      select: { modelKey: true, price: true },
    });

    // Regroupe les prix par clé de modèle.
    const pricesByModel = new Map<string, number[]>();
    for (const obs of observations) {
      const list = pricesByModel.get(obs.modelKey) ?? [];
      list.push(obs.price.toNumber());
      pricesByModel.set(obs.modelKey, list);
    }

    let updated = 0;
    for (const [modelKey, prices] of pricesByModel) {
      prices.sort((a, b) => a - b);

      const median = percentile(prices, 0.5);
      const p25 = percentile(prices, 0.25);

      await this.prisma.priceStat.upsert({
        where: { modelKey },
        create: {
          modelKey,
          median: new Prisma.Decimal(median),
          p25: new Prisma.Decimal(p25),
          samples: prices.length,
        },
        update: {
          median: new Prisma.Decimal(median),
          p25: new Prisma.Decimal(p25),
          samples: prices.length,
        },
      });
      updated += 1;
    }

    this.logger.log(
      `Statistiques de prix recalculées pour ${updated} modèle(s)`,
    );
  }
}

/** Borne une valeur dans l'intervalle [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calcule un percentile (0..1) sur un tableau de nombres **déjà trié** par
 * ordre croissant, via interpolation linéaire entre rangs.
 */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const rank = q * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);

  if (lowerIndex === upperIndex) return sorted[lowerIndex];

  const weight = rank - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}
