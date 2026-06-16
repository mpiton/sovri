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
# Use the modern deployer (not `--legacy`): the legacy `pnpm deploy` places a
# workspace package's own dependencies in the store but does not link them into
# the deployed closure, so `@sovri/llm-providers`' runtime SDKs
# (@mistralai/mistralai, @anthropic-ai/sdk, openai) end up unresolvable at runtime.
RUN pnpm deploy --filter @sovri/community-bot --prod /app/deploy/community-bot
# Fail the build if the deployed closure can't resolve and instantiate the LLM
# providers. A missing SDK otherwise surfaces only at review time as a swallowed
# ERR_MODULE_NOT_FOUND, i.e. every review returns a bare "review failed".
RUN cd /app/deploy/community-bot \
 && node --input-type=module -e "import { createProviderFromConfig } from '@sovri/llm-providers'; const env = { K: 'smoke-test-placeholder' }; for (const provider of ['mistral', 'anthropic', 'openai']) { try { createProviderFromConfig({ llm: { provider, apiKeySecret: 'K', model: 'verify' } }, env); } catch (error) { console.error('community-bot: provider ' + provider + ' failed to load:', error instanceof Error ? error.message : error); process.exit(1); } } console.log('community-bot: LLM provider SDKs resolve');"

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
