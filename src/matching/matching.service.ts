import { Injectable, Logger } from '@nestjs/common';
import { VintedItem } from '../vinted/vinted.types';

/** Sous-ensemble d'une recherche utilisé pour le filtrage par mots-clés. */
export interface KeywordFilter {
  includeKeywords: string[];
  excludeKeywords: string[];
}

/**
 * Filtrage applicatif des annonces récupérées de Vinted.
 *
 * Vinted ne supporte pas nativement les mots-clés à inclure / exclure de façon
 * fiable : on applique donc une seconde passe locale, insensible à la casse et
 * aux accents, sur le titre des annonces.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  /**
   * Filtre une liste d'annonces selon les mots-clés d'inclusion / exclusion.
   *
   * - Exclut toute annonce dont le titre contient un des `excludeKeywords`.
   * - Si `includeKeywords` n'est pas vide, ne garde que les annonces dont le
   *   titre contient AU MOINS un des `includeKeywords`.
   * - La comparaison se fait sur le titre normalisé (minuscule, sans accents).
   */
  filter(items: VintedItem[], search: KeywordFilter): VintedItem[] {
    const include = this.normalizeKeywords(search?.includeKeywords);
    const exclude = this.normalizeKeywords(search?.excludeKeywords);

    if (include.length === 0 && exclude.length === 0) {
      return items;
    }

    const result = items.filter((item) => {
      const title = this.normalize(item.title);

      if (exclude.some((keyword) => title.includes(keyword))) {
        return false;
      }

      if (include.length > 0) {
        return include.some((keyword) => title.includes(keyword));
      }

      return true;
    });

    this.logger.debug(
      `Filtrage par mots-clés: ${items.length} -> ${result.length} annonces`,
    );

    return result;
  }

  /** Prépare une liste de mots-clés: normalisation + suppression des vides. */
  private normalizeKeywords(keywords?: string[]): string[] {
    if (!keywords?.length) {
      return [];
    }

    return keywords
      .map((keyword) => this.normalize(keyword))
      .filter((keyword) => keyword.length > 0);
  }

  /**
   * Normalise une chaîne pour une comparaison robuste : minuscule, accents
   * retirés (décomposition Unicode NFD + suppression des diacritiques) et
   * espaces superflus rognés.
   */
  private normalize(value: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
