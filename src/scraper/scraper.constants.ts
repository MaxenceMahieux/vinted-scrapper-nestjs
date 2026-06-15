export const SCRAPE_QUEUE = 'scrape';

/** Données portées par un job de scraping : l'id de la recherche à rejouer. */
export interface ScrapeJobData {
  searchId: string;
}
