# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --global pnpm@11.19.0 \
    && groupadd --gid 10001 zazie \
    && useradd --uid 10001 --gid zazie --home-dir /app --no-create-home zazie \
    && mkdir -p /var/lib/zazie/artifacts \
    && chown zazie:zazie /var/lib/zazie/artifacts
# Operational commands use the same locked dependencies and source as the built services.
COPY --from=build --chown=zazie:zazie /app /app
USER zazie
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
