import { Injectable } from '@nestjs/common';
import { Listing, SavedSearch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VintedItem } from '../vinted/vinted.types';

/** Annonce accompagnée de la recherche qui l'a fait remonter (pour le pays). */
export type ListingWithSearch = Listing & { search: SavedSearch };

/**
 * Item Vinted enrichi des données de pricing/scoring calculées en amont
 * (clé de modèle normalisée et résultat du scoring deal).
 */
export type EnrichedVintedItem = VintedItem & {
  modelKey?: string | null;
  dealScore?: number | null;
  isDeal?: boolean;
};

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste les items d'une recherche et renvoie uniquement ceux qui sont
   * nouveaux (jamais vus pour cette recherche). La déduplication repose sur la
   * contrainte unique (searchId, vintedItemId).
   *
   * Les champs optionnels `modelKey`, `dealScore` et `isDeal` sont persistés
   * lorsqu'ils sont fournis par le pipeline de scraping.
   */
  async saveNew(
    searchId: string,
    items: EnrichedVintedItem[],
  ): Promise<Listing[]> {
    const created: Listing[] = [];

    for (const item of items) {
      try {
        const listing = await this.prisma.listing.create({
          data: {
            searchId,
            vintedItemId: BigInt(item.id),
            title: item.title,
            price: item.price,
            totalPrice: item.totalPrice ?? undefined,
            currency: item.currency,
            url: item.url,
            photoUrl: item.photoUrl,
            brand: item.brand,
            size: item.size,
            condition: item.condition,
            statusId: item.statusId,
            sellerLogin: item.sellerLogin,
            publishedAt: item.publishedAt,
            modelKey: item.modelKey ?? undefined,
            dealScore: item.dealScore ?? undefined,
            isDeal: item.isDeal ?? undefined,
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

  /** Récupère une annonce avec sa recherche (pour résoudre le pays, l'item…). */
  findByIdWithSearch(id: string): Promise<ListingWithSearch | null> {
    return this.prisma.listing.findUnique({
      where: { id },
      include: { search: true },
    });
  }

  /** Marque (ou démarque) une annonce comme favorite. */
  setFavorite(id: string, isFavorite: boolean): Promise<Listing> {
    return this.prisma.listing.update({
      where: { id },
      data: { isFavorite },
    });
  }
}
