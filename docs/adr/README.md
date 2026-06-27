# Architecture Decision Records (ADR)

This directory contains the Architecture Decision Records of Sovri, following the format proposed by Michael Nygard.

## What is an ADR?

An ADR documents a **structural** architecture decision, its context, and its consequences. It is not modified after acceptance — if the decision changes, a new ADR is created that supersedes the old one.

An ADR is not user documentation. It is a log of technical choices intended for current and future developers of the project.

## Convention

- Sequential numbering on 3 digits (`001`, `002`, …)
- File name: `NNN-title-in-kebab-case.md`
- Once an ADR is `Accepted`, its content is no longer edited; a new ADR is created that supersedes it if the decision changes

## Index

| #                                                          | Title                                                            | Status   | Date       |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | -------- | ---------- |
| [001](./001-runtime-typescript.md)                         | Node.js LTS + strict TypeScript                                  | Accepted | 2026-05-12 |
| [002](./002-monorepo-pnpm-turborepo.md)                    | Monorepo with pnpm + Turborepo                                   | Accepted | 2026-05-12 |
| [003](./003-esm-only.md)                                   | ESM only, no CommonJS                                            | Accepted | 2026-05-12 |
| [004](./004-probot-framework.md)                           | Probot as GitHub App framework                                   | Accepted | 2026-05-12 |
| [005](./005-zod-runtime-validation.md)                     | Zod 4 for runtime validation                                     | Accepted | 2026-05-12 |
| [006](./006-pino-then-otel.md)                             | Pino from v0.1, OpenTelemetry from v0.5                          | Accepted | 2026-05-12 |
| [007](./007-vitest-msw-testing.md)                         | Vitest + MSW for testing                                         | Accepted | 2026-05-12 |
| [008](./008-tsup-bundler.md)                               | tsup as package bundler                                          | Accepted | 2026-05-12 |
| [009](./009-docker-multistage-ghcr.md)                     | Multi-stage Docker + GitHub Container Registry                   | Accepted | 2026-05-12 |
| [010](./010-licence-apache-2.md)                           | Apache 2.0 license on Community code                             | Accepted | 2026-05-12 |
| [011](./011-oxlint-oxfmt.md)                               | oxlint + oxfmt for TypeScript/JavaScript lint and format         | Accepted | 2026-05-12 |
| [012](./012-lefthook-ci-gates.md)                          | Lefthook + non-negotiable CI gates                               | Accepted | 2026-05-12 |
| [013](./013-compliance-trail-as-primary-differentiator.md) | Compliance Trail as primary differentiator                       | Accepted | 2026-05-27 |
| [014](./014-ed25519-hash-chain-audit-trail.md)             | Ed25519 hash-chain audit trail                                   | Accepted | 2026-05-27 |
| [015](./015-brand-design-system-package.md)                | Design system as the @sovri/brand package                        | Accepted | 2026-06-02 |
| [016](./016-bot-output-markdown-css-harness.md)            | Bot review output is GitHub Markdown; CSS is a local harness     | Accepted | 2026-06-02 |
| [017](./017-optional-walkthrough-provenance-field.md)      | Provenance as an optional walkthrough-input field                | Accepted | 2026-06-02 |
| [018](./018-github-checks-output-surface.md)               | GitHub Checks API as a bot output surface                        | Accepted | 2026-06-02 |
| [019](./019-otel-milestone-v0-6.md)                        | OpenTelemetry instrumentation deferred to v0.6 (revises ADR-006) | Accepted | 2026-06-02 |
| [020](./020-deterministic-compliance-derivation.md)        | Deterministic compliance derivation                              | Accepted | 2026-06-19 |
| [021](./021-compliance-only-review-taxonomy.md)            | Compliance-only review taxonomy and prompt                       | Accepted | 2026-06-24 |
| [022](./022-project-level-compliance-pivot.md)             | Project-level compliance pivot vocabulary                        | Accepted | 2026-06-26 |

## Possible statuses

- **Proposed** — under discussion, not yet acted upon
- **Accepted** — decision made, to be applied
- **Deprecated** — no longer applied, but kept for traceability
- **Superseded by ADR-NNN** — replaced by another ADR (mandatory reference)
