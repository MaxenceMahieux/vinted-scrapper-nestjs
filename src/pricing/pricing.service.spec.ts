import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';

/** Lit le premier argument du Nième appel à un mock d'upsert, typé. */
function upsertArg(mock: jest.Mock, index = 0): Prisma.PriceStatUpsertArgs {
  const calls = mock.mock.calls as Prisma.PriceStatUpsertArgs[][];
  return calls[index][0];
}

/** Lit la valeur numérique d'un champ Decimal du bloc `create` d'un upsert. */
function createDecimal(
  args: Prisma.PriceStatUpsertArgs,
  field: 'median' | 'p25',
): number {
  return (args.create[field] as Prisma.Decimal).toNumber();
}

/** Crée une stat factice avec une médiane et un nombre d'échantillons. */
function makeStat(modelKey: string, median: number, samples: number) {
  return {
    modelKey,
    median: new Prisma.Decimal(median),
    p25: new Prisma.Decimal(median * 0.8),
    samples,
    updatedAt: new Date(),
  };
}

describe('PricingService', () => {
  let service: PricingService;
  let prisma: {
    priceStat: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    priceObservation: {
      findMany: jest.Mock;
      createMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      priceStat: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      priceObservation: {
        findMany: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PricingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PricingService>(PricingService);
  });

  describe('scoreDeal', () => {
    it('flags a clear bargain as a deal', async () => {
      // Médiane 100, prix 50 → ratio 0.5 < 0.7, 10 échantillons.
      prisma.priceStat.findUnique.mockResolvedValue(
        makeStat('seiko_srpb43', 100, 10),
      );

      const result = await service.scoreDeal(50, 'seiko_srpb43');

      expect(result.isDeal).toBe(true);
      expect(result.score).toBeCloseTo(0.5);
      expect(result.savings).toBeCloseTo(50);
      expect(result.ref).toBe(100);
    });

    it('does not flag a deal when the price is close to median', async () => {
      // Médiane 100, prix 90 → ratio 0.9 ≥ 0.7.
      prisma.priceStat.findUnique.mockResolvedValue(
        makeStat('seiko_srpb43', 100, 10),
      );

      const result = await service.scoreDeal(90, 'seiko_srpb43');

      expect(result.isDeal).toBe(false);
      expect(result.score).toBeCloseTo(0.1);
      expect(result.savings).toBeCloseTo(10);
      expect(result.ref).toBe(100);
    });

    it('does not flag a deal when there are too few samples', async () => {
      // Bon ratio (0.5) mais seulement 3 échantillons (< 5).
      prisma.priceStat.findUnique.mockResolvedValue(
        makeStat('seiko_srpb43', 100, 3),
      );

      const result = await service.scoreDeal(50, 'seiko_srpb43');

      expect(result.isDeal).toBe(false);
      expect(result.score).toBeCloseTo(0.5);
    });

    it('returns a neutral score when no stat exists (no ref)', async () => {
      prisma.priceStat.findUnique.mockResolvedValue(null);

      const result = await service.scoreDeal(50, 'unknown_model');

      expect(result).toEqual({
        score: 0,
        isDeal: false,
        savings: 0,
        ref: null,
      });
    });

    it('clamps the score to 1 when price is far above median', async () => {
      prisma.priceStat.findUnique.mockResolvedValue(
        makeStat('seiko_srpb43', 100, 10),
      );

      // Prix négatif théorique → ratio < 0, score clampé à 1.
      const result = await service.scoreDeal(0, 'seiko_srpb43');

      expect(result.score).toBe(1);
      expect(result.isDeal).toBe(true);
    });

    it('never produces a score below 0 when price exceeds median', async () => {
      prisma.priceStat.findUnique.mockResolvedValue(
        makeStat('seiko_srpb43', 100, 10),
      );

      const result = await service.scoreDeal(200, 'seiko_srpb43');

      expect(result.score).toBe(0);
      expect(result.isDeal).toBe(false);
      expect(result.savings).toBe(0);
    });
  });

  describe('recomputeAllStats (percentile computation)', () => {
    it('computes median and p25 across observations grouped by model', async () => {
      // Prix volontairement non triés : 10,20,30,40,50.
      prisma.priceObservation.findMany.mockResolvedValue([
        { modelKey: 'm1', price: new Prisma.Decimal(30) },
        { modelKey: 'm1', price: new Prisma.Decimal(10) },
        { modelKey: 'm1', price: new Prisma.Decimal(50) },
        { modelKey: 'm1', price: new Prisma.Decimal(20) },
        { modelKey: 'm1', price: new Prisma.Decimal(40) },
      ]);

      await service.recomputeAllStats();

      expect(prisma.priceStat.upsert).toHaveBeenCalledTimes(1);
      const call = upsertArg(prisma.priceStat.upsert);

      expect(call.where).toEqual({ modelKey: 'm1' });
      // Médiane (q=0.5) sur [10,20,30,40,50] → rang 2 → 30.
      expect(createDecimal(call, 'median')).toBeCloseTo(30);
      // p25 (q=0.25) → rang 1 → 20.
      expect(createDecimal(call, 'p25')).toBeCloseTo(20);
      expect(call.create.samples).toBe(5);
    });

    it('interpolates percentiles between ranks for even-sized sets', async () => {
      // [10,20,30,40] : médiane = (20+30)/2 = 25 ; p25 → rang 0.75 → 17.5.
      prisma.priceObservation.findMany.mockResolvedValue([
        { modelKey: 'm2', price: new Prisma.Decimal(10) },
        { modelKey: 'm2', price: new Prisma.Decimal(20) },
        { modelKey: 'm2', price: new Prisma.Decimal(30) },
        { modelKey: 'm2', price: new Prisma.Decimal(40) },
      ]);

      await service.recomputeAllStats();

      const call = upsertArg(prisma.priceStat.upsert);
      expect(createDecimal(call, 'median')).toBeCloseTo(25);
      expect(createDecimal(call, 'p25')).toBeCloseTo(17.5);
    });

    it('upserts one stat per distinct model key', async () => {
      prisma.priceObservation.findMany.mockResolvedValue([
        { modelKey: 'm1', price: new Prisma.Decimal(10) },
        { modelKey: 'm2', price: new Prisma.Decimal(20) },
      ]);

      await service.recomputeAllStats();

      expect(prisma.priceStat.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
