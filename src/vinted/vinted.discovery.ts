import { Injectable, Logger } from '@nestjs/common';
import { VintedClient } from './vinted.client';
import { VintedBrand, VintedCatalog, VintedFacet } from './vinted.types';

/**
 * Service d'aide à la découverte des identifiants Vinted.
 *
 * Permet à l'utilisateur de retrouver les `catalog_ids` (catégories) et
 * `brand_ids` (marques) nécessaires pour configurer une SavedSearch. Réutilise
 * la session authentifiée du VintedClient (throttle + retry inclus).
 */
@Injectable()
export class VintedDiscoveryService {
  private readonly logger = new Logger(VintedDiscoveryService.name);

  constructor(private readonly client: VintedClient) {}

  /** Récupère l'arbre des catégories du catalogue Vinted. */
  async getCatalogs(country?: string): Promise<VintedCatalog[]> {
    const data = await this.client.authenticatedGet<{
      catalogs?: VintedCatalog[];
    }>('/api/v2/catalogs', { country });
    const catalogs = data?.catalogs ?? [];
    this.logger.debug(
      `Catalogues Vinted récupérés (${catalogs.length} racines)`,
    );
    return catalogs;
  }

  /** Recherche des marques par mot-clé (pour trouver leurs brand_ids). */
  async searchBrands(name: string, country?: string): Promise<VintedBrand[]> {
    const data = await this.client.authenticatedGet<{
      brands?: VintedBrand[];
    }>('/api/v2/brands', { params: { keyword: name }, country });
    const brands = data?.brands ?? [];
    this.logger.debug(
      `Marques Vinted trouvées pour "${name}" (${brands.length})`,
    );
    return brands;
  }

  /**
   * Découvre les facettes de filtres d'une catégorie (matière, couleur, etc.)
   * et leurs options, pour résoudre les IDs à placer dans `facets`.
   */
  async getCatalogFilters(
    catalogId: number,
    country?: string,
  ): Promise<VintedFacet[]> {
    const facets = await this.client.getCatalogFilters(catalogId, country);
    this.logger.debug(
      `Facettes Vinted récupérées (catalogId=${catalogId}): ${facets.length}`,
    );
    return facets;
  }
}
