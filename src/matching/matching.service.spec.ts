import { Test, TestingModule } from '@nestjs/testing';
import { MatchingService } from './matching.service';
import { VintedItem } from '../vinted/vinted.types';

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchingService],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
  });

  /** Fabrique un VintedItem minimal avec le titre voulu. */
  const item = (id: number, title: string): VintedItem => ({
    id,
    title,
    price: 10,
    currency: 'EUR',
    url: `https://www.vinted.fr/items/${id}`,
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns all items when both keyword lists are empty', () => {
    const items = [item(1, 'Nike Air Max'), item(2, 'Adidas Stan Smith')];

    const result = service.filter(items, {
      includeKeywords: [],
      excludeKeywords: [],
    });

    expect(result).toEqual(items);
  });

  describe('includeKeywords', () => {
    it('keeps only items whose title contains at least one include keyword', () => {
      const items = [
        item(1, 'Nike Air Max 90'),
        item(2, 'Adidas Stan Smith'),
        item(3, 'Nike Dunk Low'),
      ];

      const result = service.filter(items, {
        includeKeywords: ['nike'],
        excludeKeywords: [],
      });

      expect(result.map((i) => i.id)).toEqual([1, 3]);
    });

    it('matches when any of the include keywords is present', () => {
      const items = [
        item(1, 'Veste en cuir'),
        item(2, 'Pull en laine'),
        item(3, 'Chemise en coton'),
      ];

      const result = service.filter(items, {
        includeKeywords: ['cuir', 'laine'],
        excludeKeywords: [],
      });

      expect(result.map((i) => i.id)).toEqual([1, 2]);
    });

    it('returns an empty array when no item matches the include keywords', () => {
      const items = [item(1, 'Nike Air Max'), item(2, 'Adidas Stan Smith')];

      const result = service.filter(items, {
        includeKeywords: ['puma'],
        excludeKeywords: [],
      });

      expect(result).toEqual([]);
    });
  });

  describe('excludeKeywords', () => {
    it('removes items whose title contains an exclude keyword', () => {
      const items = [
        item(1, 'Nike Air Max neuf'),
        item(2, 'Nike Air Max replica'),
        item(3, 'Nike Air Max original'),
      ];

      const result = service.filter(items, {
        includeKeywords: [],
        excludeKeywords: ['replica'],
      });

      expect(result.map((i) => i.id)).toEqual([1, 3]);
    });

    it('exclude takes precedence over include', () => {
      const items = [
        item(1, 'Nike Air Max replica'),
        item(2, 'Nike Air Max neuf'),
      ];

      const result = service.filter(items, {
        includeKeywords: ['nike'],
        excludeKeywords: ['replica'],
      });

      expect(result.map((i) => i.id)).toEqual([2]);
    });
  });

  describe('accent and case normalization', () => {
    it('matches include keywords regardless of accents and case', () => {
      const items = [
        item(1, 'Robe décontractée'),
        item(2, 'Pantalon classique'),
      ];

      // keyword "decontractee" (sans accent) doit matcher "décontractée"
      const result = service.filter(items, {
        includeKeywords: ['DECONTRACTEE'],
        excludeKeywords: [],
      });

      expect(result.map((i) => i.id)).toEqual([1]);
    });

    it('matches exclude keywords regardless of accents and case', () => {
      const items = [item(1, 'Sac à main usé'), item(2, 'Sac à main neuf')];

      const result = service.filter(items, {
        includeKeywords: [],
        excludeKeywords: ['USE'],
      });

      expect(result.map((i) => i.id)).toEqual([2]);
    });
  });

  describe('empty / edge inputs', () => {
    it('returns an empty array when items is empty', () => {
      const result = service.filter([], {
        includeKeywords: ['nike'],
        excludeKeywords: ['replica'],
      });

      expect(result).toEqual([]);
    });

    it('ignores blank keywords', () => {
      const items = [item(1, 'Nike Air Max'), item(2, 'Adidas')];

      const result = service.filter(items, {
        includeKeywords: ['   ', ''],
        excludeKeywords: ['  '],
      });

      // tous les mots-clés sont vides après normalisation -> aucun filtre
      expect(result).toEqual(items);
    });
  });
});
