# Vinted Scrapper

Scrappe le catalogue Vinted à intervalle régulier et envoie une notification
Telegram dès qu'une nouvelle annonce correspond à une recherche sauvegardée
(catégorie, marque, fourchette de prix, mots-clés…).

## Architecture

```
@nestjs/schedule (cron)  ──►  BullMQ queue  ──►  Worker
   1 job / recherche                              │
                                                  ├─► VintedClient  (API interne /api/v2/catalog/items)
                                                  ├─► Listings      (persistance + dédup Postgres)
                                                  └─► Notifier      (Telegram)
```

| Module      | Rôle                                                          |
| ----------- | ------------------------------------------------------------- |
| `vinted`    | Client HTTP de l'API interne Vinted (cookie de session auto)  |
| `searches`  | CRUD des recherches sauvegardées (table Postgres)             |
| `scraper`   | Cron qui enfile les jobs + worker BullMQ qui exécute le cycle |
| `listings`  | Persistance des annonces et déduplication                     |
| `notifier`  | Envoi des notifications (Telegram)                            |
| `prisma`    | Accès base de données                                         |

## Démarrage (Docker)

```bash
cp .env.example .env   # puis renseigner TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
npm run docker:up      # Postgres + Redis + app (migrations appliquées au boot)
npm run docker:logs
```

## Démarrage (local)

```bash
cp .env.example .env
# Postgres + Redis doivent tourner (cf. docker-compose)
npm install
npm run prisma:migrate
npm run start:dev
```

## Créer une recherche

```bash
curl -X POST http://localhost:3000/searches \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Seiko Presage 200-300€",
    "searchText": "seiko presage",
    "catalogIds": [97],
    "priceFrom": 150,
    "priceTo": 400
  }'
```

Les recherches activées sont rejouées automatiquement par le cron (`SCRAPE_CRON`).

## Roadmap

- Deal scorer : prix de référence par modèle + score de bonne affaire
- Dashboard Next.js (config + historique de prix)
- Filtrage avancé (état, full set, ancienneté vendeur)
- Proxies résidentiels si rate-limit Cloudflare

## ⚠️ Note

Le scraping de Vinted n'utilise pas d'API officielle et contrevient aux CGU.
Usage personnel, faible volume, pas de revente de données.
