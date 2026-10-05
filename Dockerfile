FROM node:24-bookworm AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/shared packages/shared
ARG VITE_SERVER_URL=
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN pnpm build

FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/prisma apps/server/prisma
USER node
CMD ["node", "apps/server/dist/main.js"]

FROM caddy:2.10.2-alpine AS web
COPY --from=build /app/apps/web/dist /srv/web
COPY docker/production/Caddyfile /etc/caddy/Caddyfile
