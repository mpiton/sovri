<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Sovri SAS
-->

# `@sovri/observability`

Unified observability layer for Sovri. **v0.1 ships Pino only**; OpenTelemetry
joins at v0.5 without breaking the public API (see ADR-006).

## Public API

| Export               | Kind                         | Stability      |
| -------------------- | ---------------------------- | -------------- |
| `createLogger(name)` | runtime function             | stable in v0.1 |
| `Logger`             | type alias (= Pino `Logger`) | stable in v0.1 |

```ts
import { createLogger } from "@sovri/observability";

const log = createLogger("handler:pull-request");
log.info({ delivery_id: "abc", action: "synchronize" }, "received webhook");
```

Every record carries the base bindings `{ service, version, env }` from
`SERVICE_NAME`, `SERVICE_VERSION`, `NODE_ENV`, plus `{ component: name }`
attached by `createLogger`. Child loggers via `log.child({ ... })` inherit
both the bindings and the redaction policy below.

### Environment variables

| Variable          | Default               | Effect                                                                                                   |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`       | `info`                | Pino level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`); invalid values fall back to `info`. |
| `LOG_PRETTY`      | `false`               | `true`/`1`/`yes`/`on` enable `pino-pretty` for local dev; ignored when `NODE_ENV=production`.            |
| `NODE_ENV`        | `development`         | `production` disables pretty transport unconditionally.                                                  |
| `SERVICE_NAME`    | `sovri-community-bot` | Base binding.                                                                                            |
| `SERVICE_VERSION` | `0.0.0`               | Base binding.                                                                                            |

Empty-string env vars are treated as unset (docker-compose / Helm parity).

## Redaction policy

Pino's `redact` option strips sensitive values **at logger creation time**;
the path list is compiled once and reused on every record. The censor is
the literal string `[Redacted]`. Child loggers inherit the configuration
automatically.

### Paths

| Path                    | Catches                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `authorization`         | top-level `authorization` field                                         |
| `*.authorization`       | any one-level-nested `authorization` (e.g. `req.authorization`)         |
| `headers.authorization` | HTTP request headers in webhook payloads                                |
| `apiKey`                | LLM provider keys passed at the top level                               |
| `*.apiKey`              | LLM provider keys nested under a single parent (e.g. `provider.apiKey`) |
| `api_key`               | snake-case variant from third-party SDKs                                |
| `token`                 | GitHub OAuth / installation token                                       |
| `*.token`               | nested token (e.g. `ctx.token`)                                         |
| `installation.token`    | the canonical GitHub App installation token shape                       |
| `pem`                   | GitHub App private key in PEM form                                      |
| `privateKey`            | private key under any common camelCase name                             |
| `secret`                | catch-all generic secret field                                          |
| `webhook_secret`        | webhook signing secret                                                  |
| `*.webhook_secret`      | nested webhook secret in `.sovri.yml` style configs                     |

### Examples

Input:

```ts
log.info({ token: "gho_xxxxxxxxxxxxxxxx" }, "ping");
```

Output (JSON line, abridged):

```json
{ "level": 30, "component": "test", "token": "[Redacted]", "msg": "ping" }
```

Nested input:

```ts
log.info({ headers: { authorization: "Bearer gho_secret" } });
```

Output:

```json
{ "headers": { "authorization": "[Redacted]" } }
```

### What is **not** redacted

The redact list is conservative on purpose: it only strips fields whose
names match a known secret-bearing shape. Free-text fields (`msg`,
`message`, arbitrary error bodies) pass through untouched. **Never** log a
raw webhook payload, LLM response, or stack trace that may contain
embedded tokens. If you receive a payload that may contain secrets,
extract the structured fields you need and log those — do not log the
full object.

### Limitations (v0.1)

The matcher is Pino's compile-time path matcher. Three classes of input
are **not** caught and must be handled by the caller:

1. **Case sensitivity.** Pino paths are case-sensitive. `authorization`
   does not match `Authorization`. Node.js HTTP lowercases inbound
   headers, so a value reaching the logger via Probot's `context.request`
   path is safe. A hand-built object with `Authorization` capitalised
   would leak. Lowercase headers before logging objects of unknown
   shape.

2. **Nesting depth > 2.** Wildcards (`*.X`) match a single level. A path
   like `a.b.token` (depth 3 from the log record root) is **not**
   redacted. Downstream packages that log nested Probot context objects
   (`context.payload.installation.token` lives at depth 3 if the whole
   `context` is logged) must extend their local redact set or extract the
   inner fields before logging.

3. **Free-text / error stacks.** `err.message`, `err.stack`, and any
   string template (`` `Bearer ${token}` ``) bypass the path matcher.
   Pino's default `err` serializer emits stack traces verbatim. Strip or
   regex-scrub error strings at the call site, or replace the serializer.

The boundary cases are pinned by tests in `src/logger.test.ts` under
`describe("redaction boundaries")` so any future broadening of the
matcher will surface in CI.

### Audit grep

The redact source of truth lives in a single place — search for
`REDACT_PATHS` in `packages/observability/src/logger.ts`. The README path
table mirrors that array; the source is authoritative.

## Scope

- **v0.1 (this release)** — Pino structured JSON logger with redaction,
  `createLogger` factory, env-driven configuration.
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
