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
RUN pnpm deploy --filter @sovri/community-bot --prod /app/deploy/community-bot
# `pnpm deploy` copies a workspace package's own dependencies into the closure's
# .pnpm store but does not create the links Node needs to resolve them, so
# `@sovri/llm-providers`' provider SDKs (@mistralai/mistralai, @anthropic-ai/sdk,
# openai) are unreachable at runtime. Link them at the closure's node_modules
# root; Node resolves up to here from the nested @sovri package.
RUN cd /app/deploy/community-bot/node_modules \
 && ln -sf "$(ls -d .pnpm/@mistralai+mistralai@*/node_modules/@mistralai | head -1)" @mistralai \
 && ln -sf "$(ls -d .pnpm/@anthropic-ai+sdk@*/node_modules/@anthropic-ai | head -1)" @anthropic-ai \
 && ln -sf "$(ls -d .pnpm/openai@*/node_modules/openai | head -1)" openai

FROM node:24-alpine AS runtime

ENV HOST="0.0.0.0"
ENV NODE_ENV="production"
ENV PORT="3000"

WORKDIR /app

RUN addgroup -g 1001 -S sovri && adduser -u 1001 -S sovri -G sovri

COPY --from=prod-deps --chown=sovri:sovri /app/deploy/community-bot/ ./

# Smoke-check the SHIPPED closure: this stage holds only the deployed node_modules,
# so resolution here is exactly what runs in production and cannot be masked by a
# workspace install. Fails the build if a provider SDK is unresolvable.
RUN node --input-type=module -e "import { createProviderFromConfig } from '@sovri/llm-providers'; const env = { K: 'smoke-test-placeholder' }; for (const provider of ['mistral', 'anthropic', 'openai']) { try { createProviderFromConfig({ llm: { provider, apiKeySecret: 'K', model: 'verify' } }, env); } catch (error) { console.error('community-bot: provider ' + provider + ' failed to load:', error instanceof Error ? error.message : error); process.exit(1); } } console.log('community-bot: LLM provider SDKs resolve');"

USER sovri

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]
