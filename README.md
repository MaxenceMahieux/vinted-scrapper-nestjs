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

## Déploiement Coolify

L'application se déploie sur [Coolify](https://coolify.io/) en tant que ressource
**Dockerfile** (build sur le stage `production`).

1. **Ressources managées** : créer dans le même projet Coolify une base
   **PostgreSQL** et un **Redis** (services managés Coolify). Récupérer leurs
   identifiants de connexion internes.
2. **Application** : créer une ressource « Dockerfile » pointant sur ce dépôt.
   Coolify build l'image et lance le conteneur de production.
3. **Variables d'environnement** : renseigner les variables ci-dessous dans
   l'onglet *Environment Variables* (au minimum `DATABASE_URL`, `REDIS_HOST`,
   `REDIS_PORT`, et les canaux de notification souhaités).
4. **Migrations automatiques** : l'`docker-entrypoint.sh` exécute
   `npx prisma migrate deploy` avant de démarrer l'application — les migrations
   sont donc appliquées à chaque déploiement, aucune action manuelle requise.
5. **Healthcheck** : configurer le health check Coolify sur `GET /health`
   (port `3000`). L'endpoint vérifie la base PostgreSQL (`SELECT 1`) et Redis
   (`PING`) via `@nestjs/terminus`.

## Variables d'environnement

| Variable               | Rôle                                                   | Défaut          |
| ---------------------- | ------------------------------------------------------ | --------------- |
| `DATABASE_URL`         | Chaîne de connexion PostgreSQL (Prisma)                | —               |
| `REDIS_HOST`           | Hôte Redis (BullMQ + healthcheck)                      | `localhost`     |
| `REDIS_PORT`           | Port Redis                                             | `6379`          |
| `PORT`                 | Port d'écoute HTTP de l'application                    | `3000`          |
| `SCRAPE_CRON`          | Expression cron d'enfilage des recherches             | —               |
| `PRICE_STATS_CRON`     | Cron de recalcul des statistiques de prix par modèle   | —               |
| `TELEGRAM_BOT_TOKEN`   | Token du bot Telegram (canal `telegram`)               | —               |
| `TELEGRAM_CHAT_ID`     | Chat/canal cible des notifications Telegram            | —               |
| `SMTP_HOST`            | Hôte SMTP (canal `email`)                              | —               |
| `SMTP_PORT`            | Port SMTP                                               | —               |
| `SMTP_USER`            | Utilisateur SMTP                                       | —               |
| `SMTP_PASSWORD`        | Mot de passe SMTP                                      | —               |
| `SMTP_FROM`            | Adresse expéditrice des e-mails                       | —               |
| `SMTP_TO`              | Adresse destinataire des notifications e-mail          | —               |

Les canaux de notification sont activés par recherche via le champ `channels`
(ex. `["telegram"]`, `["email"]`) ; un canal n'est utilisé que si ses variables
d'environnement sont renseignées.

## Roadmap

- Deal scorer : prix de référence par modèle + score de bonne affaire
- Dashboard Next.js (config + historique de prix)
- Filtrage avancé (état, full set, ancienneté vendeur)
- Proxies résidentiels si rate-limit Cloudflare

## ⚠️ Note

Le scraping de Vinted n'utilise pas d'API officielle et contrevient aux CGU.
Usage personnel, faible volume, pas de revente de données.
