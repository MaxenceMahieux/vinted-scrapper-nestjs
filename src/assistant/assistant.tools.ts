import Anthropic from '@anthropic-ai/sdk';

/**
 * Champs de filtre communs à create_search / update_search, mappés 1:1 sur
 * CreateSearchDto. Réutilisés dans les deux schémas d'outils.
 */
const SEARCH_FILTER_PROPERTIES = {
  searchText: {
    type: 'string',
    description:
      'Mots-clés envoyés à la recherche Vinted (ex. "seiko presage").',
  },
  catalogIds: {
    type: 'array',
    items: { type: 'integer' },
    description:
      'IDs de catégories Vinted. À résoudre via search_catalogs si inconnus.',
  },
  brandIds: {
    type: 'array',
    items: { type: 'integer' },
    description:
      'IDs de marques Vinted. À résoudre via search_brands si inconnus.',
  },
  statusIds: {
    type: 'array',
    items: { type: 'integer' },
    description: "IDs d'état/condition Vinted (neuf, très bon état, etc.).",
  },
  sizeIds: {
    type: 'array',
    items: { type: 'integer' },
    description: 'IDs de tailles Vinted.',
  },
  priceFrom: { type: 'number', description: 'Prix minimum.' },
  priceTo: { type: 'number', description: 'Prix maximum.' },
  country: {
    type: 'string',
    description: 'Pays Vinted: fr, de, it, es, be. Défaut fr.',
  },
  includeKeywords: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Filtre local: le titre doit contenir au moins un de ces mots.',
  },
  excludeKeywords: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Filtre local anti-bruit: le titre ne doit contenir aucun de ces mots.',
  },
  channels: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Canaux de notification: telegram, discord, ntfy, email. Défaut ["telegram"].',
  },
  dealOnly: {
    type: 'boolean',
    description: 'Ne notifier que les bonnes affaires (deal scorer).',
  },
  minDealScore: {
    type: 'number',
    description: 'Seuil de score 0..1 si dealOnly est activé.',
  },
} as const;

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_search',
    description:
      'Crée une nouvelle recherche/alerte Vinted. Utilise search_brands / search_catalogs avant si les IDs de marque/catégorie sont nécessaires.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Nom court et descriptif de l'alerte.",
        },
        ...SEARCH_FILTER_PROPERTIES,
      },
      required: ['name'],
    },
  },
  {
    name: 'list_searches',
    description:
      'Liste toutes les recherches sauvegardées avec leur id et état.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_search',
    description:
      "Modifie une recherche existante. Mettre enabled=false pour mettre en pause, true pour réactiver. Utiliser l'id renvoyé par list_searches.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la recherche à modifier.' },
        name: { type: 'string', description: "Nouveau nom de l'alerte." },
        enabled: {
          type: 'boolean',
          description: 'Active (true) ou met en pause (false) la recherche.',
        },
        ...SEARCH_FILTER_PROPERTIES,
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_search',
    description:
      'Supprime définitivement une recherche. Demander confirmation à l’utilisateur avant.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la recherche à supprimer.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'test_search',
    description:
      "Diagnostic: exécute immédiatement un appel Vinted réel pour une recherche donnée et renvoie le nombre d'annonces récupérées (ou l'erreur exacte). À utiliser quand l'utilisateur veut vérifier que le scraping fonctionne.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la recherche à tester.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'run_search_now',
    description:
      "Exécute IMMÉDIATEMENT le cycle complet d'une recherche (récupération Vinted → filtres → dédup → envoi des notifications) et renvoie les compteurs : annonces récupérées, filtrées, nouvelles, notifiées. À utiliser pour forcer un scrape et vérifier que les notifications partent vraiment.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID de la recherche à exécuter.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_brands',
    description:
      'Recherche des marques Vinted par nom pour obtenir leurs brandIds.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nom de la marque à chercher.' },
        country: { type: 'string', description: 'Pays Vinted (défaut fr).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_catalogs',
    description:
      "Récupère l'arborescence des catégories Vinted pour trouver des catalogIds.",
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Pays Vinted (défaut fr).' },
      },
    },
  },
];

export const ASSISTANT_SYSTEM_PROMPT = `Tu es l'assistant du "Vinted Scrapper", une app personnelle qui surveille Vinted et envoie des alertes (Telegram, etc.) dès qu'une nouvelle annonce correspond à une recherche sauvegardée.

Ton rôle : discuter en français avec l'utilisateur et traduire ses demandes en langage naturel en appels d'outils pour gérer ses recherches/alertes. L'utilisateur ne connaît pas le format JSON des filtres — c'est toi qui le construis.

Filtres disponibles d'une recherche :
- searchText : mots-clés (comme la barre de recherche Vinted)
- catalogIds / brandIds / statusIds / sizeIds : IDs Vinted
- priceFrom / priceTo : fourchette de prix
- country : fr (défaut), de, it, es, be
- includeKeywords : le titre DOIT contenir un de ces mots (filtre local)
- excludeKeywords : le titre ne doit PAS contenir ces mots (anti-bruit, ex. "réplique", "lot")
- channels : canaux de notif (défaut ["telegram"])
- dealOnly / minDealScore : ne notifier que les bonnes affaires

Règles :
- Quand une marque ou une catégorie est citée par son nom, utilise search_brands / search_catalogs pour résoudre les IDs au lieu de les deviner. Si tu ne trouves pas, mets juste le terme dans searchText.
- Avant toute suppression (delete_search), demande confirmation explicite à l'utilisateur.
- Si l'utilisateur veut vérifier/tester qu'une alerte fonctionne, utilise list_searches pour trouver son id puis test_search (diagnostic de connexion), et rapporte le nombre d'annonces ou l'erreur Vinted.
- Si l'utilisateur veut FORCER un scrape immédiat et recevoir les notifications maintenant (ex. « lance mon alerte », « scrape maintenant »), utilise run_search_now et rapporte les compteurs (récupérées / nouvelles / notifiées).
- Après une action, confirme brièvement en français ce que tu as fait (nom de la recherche, principaux filtres).
- Sois concis et naturel. Pose une question seulement si une information essentielle manque (sinon, propose des valeurs raisonnables).
- searchText filtre côté Vinted (large) ; includeKeywords/excludeKeywords filtrent localement le titre pour réduire le bruit.`;
