import { Injectable } from '@nestjs/common';
import { Listing } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VintedItem } from '../vinted/vinted.types';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste les items d'une recherche et renvoie uniquement ceux qui sont
   * nouveaux (jamais vus pour cette recherche). La déduplication repose sur la
   * contrainte unique (searchId, vintedItemId).
   */
  async saveNew(searchId: string, items: VintedItem[]): Promise<Listing[]> {
    const created: Listing[] = [];

    for (const item of items) {
      try {
        const listing = await this.prisma.listing.create({
          data: {
            searchId,
            vintedItemId: BigInt(item.id),
            title: item.title,
            price: item.price,
            currency: item.currency,
            url: item.url,
            photoUrl: item.photoUrl,
            brand: item.brand,
            size: item.size,
            sellerLogin: item.sellerLogin,
            publishedAt: item.publishedAt,
          },
        });
        created.push(listing);
      } catch (err) {
        // P2002 = violation de contrainte unique → item déjà vu, on ignore.
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }

    return created;
  }

  markNotified(ids: string[]): Promise<unknown> {
    return this.prisma.listing.updateMany({
      where: { id: { in: ids } },
      data: { notified: true },
    });
  }
}
