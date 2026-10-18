# syntax=docker/dockerfile:1

# Imagen base con pnpm disponible para todos los usuarios.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10.28.0
WORKDIR /app

# --- API: dependencias de producción + código fuente (se ejecuta con tsx) ---
FROM base AS api
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter @todo/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY VERSION VERSION

# /data/archivos debe existir y ser de appuser para que el volumen nombrado herede el propietario.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data/archivos \
    && chown -R appuser:appuser /app /data/archivos
USER appuser
EXPOSE 3000
CMD ["pnpm", "--filter", "@todo/api", "start"]

# --- Web: build de Vite ---
FROM base AS web-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @todo/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
COPY VERSION VERSION
RUN pnpm --filter @todo/web build

# --- Web: Caddy sirviendo la web estática y el proxy /api ---
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
EXPOSE 80
