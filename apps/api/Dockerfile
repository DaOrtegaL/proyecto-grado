# Imagen de la API. Se compila desde la raíz del monorepositorio.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY integrations ./integrations
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate && npm run build:libs && npm run build -w @msh/api

# Herramientas de migración y carga de datos (incluye tsx y Prisma CLI).
FROM base AS tools

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=base /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
