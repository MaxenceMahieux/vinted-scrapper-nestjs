/**
 * Mots vides ignorés lors de la normalisation : ils n'apportent aucune
 * information distinctive pour identifier un modèle.
 */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'new',
  'neuf',
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'de',
  'du',
  'et',
  'a',
  'au',
  'aux',
  'en',
  'taille',
  'size',
  'pour',
  'avec',
]);

/**
 * Normalise un titre d'annonce en une clé de modèle déterministe.
 *
 * Étapes : minuscules → suppression des accents → suppression de la
 * ponctuation → découpage en mots → filtrage des mots vides et des mots trop
 * courts (sauf références alphanumériques type « srpb43 ») → tri alphabétique
 * → jointure par « _ ».
 *
 * Le tri rend la clé indépendante de l'ordre des mots dans le titre, ce qui
 * regroupe les annonces d'un même modèle quelle que soit leur formulation.
 */
export function normalizeModelKey(title: string): string {
  if (!title) return '';

  const normalized = title
    .toLowerCase()
    .normalize('NFD')
    // Retire les diacritiques (accents) une fois décomposés.
    .replace(/[̀-ͯ]/g, '')
    // Remplace tout ce qui n'est ni lettre ni chiffre par un espace.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!normalized) return '';

  const tokens = normalized
    .split(/\s+/)
    .filter((token) => isSignificant(token));

  // Déduplique puis trie pour obtenir une clé stable.
  const unique = Array.from(new Set(tokens)).sort();

  return unique.join('_');
}

/**
 * Un token est conservé s'il s'agit d'une référence alphanumérique
 * (contient au moins un chiffre, ex. « srpb43 », « 1989 ») ou d'un mot
 * significatif (≥ 3 caractères, hors mots vides).
 */
function isSignificant(token: string): boolean {
  if (!token) return false;
  if (STOP_WORDS.has(token)) return false;

  const hasDigit = /\d/.test(token);
  if (hasDigit) return true;

  return token.length >= 3;
}
