# --- Base ---
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma

# --- Development ---
FROM base AS development
# --include=dev force l'install des devDependencies meme si NODE_ENV=production
# est injecte au build (ex. par Coolify), sinon le CLI nest est absent.
ENV NODE_ENV=development
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate

# --- Build ---
FROM base AS build
# Idem: on build avec les devDependencies (nest, typescript...), puis on prune.
ENV NODE_ENV=development
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# --- Production ---
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
CMD ["sh", "docker-entrypoint.sh"]
