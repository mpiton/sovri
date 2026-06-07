# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS builder

ENV CI="true"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsconfig.base.json ./
COPY packages/ packages/
COPY apps/community-bot/ apps/community-bot/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sovri/community-bot... build

FROM node:24-alpine AS prod-deps

ENV CI="true"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsconfig.base.json ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/community-bot/ apps/community-bot/

RUN pnpm install --frozen-lockfile --prod
RUN pnpm deploy --legacy --filter @sovri/community-bot --prod /app/deploy/community-bot

FROM node:24-alpine AS runtime

ENV HOST="0.0.0.0"
ENV NODE_ENV="production"
ENV PORT="3000"

WORKDIR /app

RUN addgroup -g 1001 -S sovri && adduser -u 1001 -S sovri -G sovri

COPY --from=prod-deps --chown=sovri:sovri /app/deploy/community-bot/ ./

USER sovri

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]
