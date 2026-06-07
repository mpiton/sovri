FROM node:24-alpine AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI="true"

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sovri/community-bot... build
RUN pnpm deploy --legacy --filter @sovri/community-bot --prod /app/deploy/community-bot

FROM node:24-alpine AS runtime

ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="3000"

WORKDIR /app

RUN addgroup -S sovri && adduser -S -G sovri sovri

COPY --from=build --chown=sovri:sovri /app/deploy/community-bot ./

USER sovri

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]
