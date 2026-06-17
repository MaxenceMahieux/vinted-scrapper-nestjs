/** Filtres d'une recherche, mappés sur l'endpoint catalog/items de Vinted. */
export interface VintedSearchFilters {
  searchText?: string | null;
  catalogIds?: number[];
  brandIds?: number[];
  statusIds?: number[];
  sizeIds?: number[];
  priceFrom?: number | null;
  priceTo?: number | null;
  order?: string;
  country?: string;
  perPage?: number;
  /**
   * Facettes génériques : map { "<param>_ids": [ids] } fusionnée telle quelle
   * dans la query (material_ids, color_ids, …). Permet d'exploiter n'importe
   * quel filtre Vinted sans champ typé dédié.
   */
  facets?: Record<string, number[]> | null;
}

/** Une option sélectionnable d'une facette (ex. « Cuir » dans « Matière »). */
export interface VintedFacetOption {
  id: number;
  title: string;
}

/** Une facette de filtre découverte pour une catégorie. */
export interface VintedFacet {
  /** Code Vinted de la facette (ex. « material »). */
  code: string;
  /** Clé de query param à placer dans `facets` (ex. « material_ids »). */
  paramKey: string;
  /** Libellé affiché (ex. « Matière »). */
  title: string;
  options: VintedFacetOption[];
}

/** Annonce normalisée renvoyée par le client (sous-ensemble utile du JSON Vinted). */
export interface VintedItem {
  id: number;
  title: string;
  /** Prix affiché de l'article (hors frais). */
  price: number;
  /** Prix effectif payé par l'acheteur (article + protection acheteurs). */
  totalPrice: number;
  currency: string;
  url: string;
  photoUrl?: string;
  brand?: string;
  size?: string;
  /** Libellé d'état (ex. « Très bon état »). */
  condition?: string;
  /** Id d'état Vinted (segmente le pricing par condition). */
  statusId?: number;
  sellerLogin?: string;
  publishedAt?: Date;
}

/** Détail d'un article suivi, utilisé pour détecter les baisses de prix. */
export interface VintedItemDetail {
  id: number;
  title: string;
  url: string;
  /** Prix effectif (article + protection acheteurs). */
  price: number;
  currency: string;
  photoUrl?: string;
  /** Faux si l'annonce est clôturée (vendue ou retirée). */
  available: boolean;
}

/** Catégorie du catalogue Vinted (aide à trouver les catalog_ids). */
export interface VintedCatalog {
  id: number;
  title: string;
  /** Sous-catégories éventuelles. */
  catalogs?: VintedCatalog[];
}

/** Marque Vinted (aide à trouver les brand_ids). */
export interface VintedBrand {
  id: number;
  title: string;
}

/** Montant Vinted (peut arriver comme objet, nombre ou chaîne selon l'endpoint). */
export type VintedAmount =
  | { amount: string; currency_code?: string }
  | string
  | number;

/** Forme brute (partielle) d'un item dans la réponse catalog/items. */
export interface RawVintedItem {
  id: number;
  title: string;
  url: string;
  brand_title?: string;
  size_title?: string;
  status?: string;
  status_id?: number;
  price?: { amount: string; currency_code: string };
  /** Prix total incluant la protection acheteurs (API récente). */
  total_item_price?: VintedAmount;
  photo?: { url?: string; high_resolution?: { timestamp?: number } };
  user?: { login?: string };
}

/** Forme brute (partielle) d'une facette dans la réponse catalog/filters. */
export interface RawVintedFilter {
  code?: string;
  title?: string;
  type?: string;
  options?: { id?: number; title?: string; value?: number }[];
}

/** Forme brute (partielle) de la réponse item detail (/api/v2/items/{id}). */
export interface RawVintedItemDetail {
  id: number;
  title: string;
  url: string;
  price?: { amount: string; currency_code: string };
  total_item_price?: VintedAmount;
  currency?: string;
  photos?: { url?: string }[];
  /** Vrai quand l'annonce est clôturée (vendue/retirée). */
  is_closed?: boolean;
  is_hidden?: boolean;
}
