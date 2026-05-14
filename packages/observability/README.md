<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Sovri SAS
-->

# `@sovri/observability`

Unified observability layer for Sovri. **v0.1 ships Pino only**; OpenTelemetry
is added in v0.5 without breaking the public API (see ADR-006).

This task delivers the package skeleton — `package.json`, `tsconfig.json`,
`tsup.config.ts`, and a barrel `src/index.ts` that re-exports only Pino's
`Logger` type so downstream consumers can already wire the future logger's
return type at compile time. No runtime symbols are exposed yet; the
`createLogger` factory described in `ARCHI.md` §4.5 lands in a follow-up
task.

## Scope

- **v0.1 (current scaffold)** — package wiring and a type-only `Logger`
  barrel re-export from `pino`. No runtime symbols yet.
- **v0.1 (follow-up task)** — Pino structured JSON logger, `LOG_LEVEL` env
  override, optional pretty-print via `LOG_PRETTY=true`. Adds the
  `createLogger` runtime export described in `ARCHI.md` §4.5.
- **v0.5+** — OpenTelemetry SDK 2.0 auto-instrumentation, OTLP exporter,
  Pino ↔ trace id correlation. Adds `initTelemetry` / `shutdownTelemetry` /
  `withSpan` / `recordMetric` exports without changing `createLogger`.

Out of scope: GitHub clients, LLM providers, file I/O outside the Pino
transport boundary. Those live in `@sovri/llm-providers`,
`packages/review-engine`, etc.

## Build wiring

Run scripts from the workspace root via
`pnpm --filter @sovri/observability <script>` or the matching Turborepo
pipeline (`pnpm turbo run <script>`). Running directly from the package
directory works only inside a `pnpm exec` shell — binaries resolve through
the workspace's pnpm symlink tree, not a per-package devDep.

## References

- `docs/adr/006-pino-then-otel.md` — Pino now, OTel at v0.5
- `docs/adr/008-tsup-bundler.md` — bundler choice and tsup config shape
- `docs/adr/010-licence-apache-2.md` — licensing model and header rule
