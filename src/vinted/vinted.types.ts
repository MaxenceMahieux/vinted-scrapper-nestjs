/** Filtres d'une recherche, mappés sur l'endpoint catalog/items de Vinted. */
export interface VintedSearchFilters {
  searchText?: string | null;
  catalogIds?: number[];
  brandIds?: number[];
  priceFrom?: number | null;
  priceTo?: number | null;
  order?: string;
  perPage?: number;
}

/** Annonce normalisée renvoyée par le client (sous-ensemble utile du JSON Vinted). */
export interface VintedItem {
  id: number;
  title: string;
  price: number;
  currency: string;
  url: string;
  photoUrl?: string;
  brand?: string;
  size?: string;
  sellerLogin?: string;
  publishedAt?: Date;
}

/** Forme brute (partielle) d'un item dans la réponse catalog/items. */
export interface RawVintedItem {
  id: number;
  title: string;
  url: string;
  brand_title?: string;
  size_title?: string;
  price?: { amount: string; currency_code: string };
  photo?: { url?: string; high_resolution?: { timestamp?: number } };
  user?: { login?: string };
}
