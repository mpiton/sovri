# ADR-002 — Monorepo with pnpm + Turborepo

**Status:** Accepted
**Date:** 2026-05-12

## Context

Sovri is distributed in two editions: Community (Apache 2.0, public) and Cloud (proprietary, private). Both editions share business types, Zod schemas, the review engine, and LLM adapters. The Cloud code adds SSO, multi-tenancy, billing, and audit log on top of Community.

Alternatives evaluated: single flat repo, separate multi-repo, monorepo (pnpm/yarn/Nx/Turborepo).

## Decision

**Monorepo with pnpm workspaces + Turborepo for build orchestration.**

Structure:

```
sovri/
├── packages/        ← shared code, published Apache 2.0
│   ├── core
│   ├── review-engine
│   ├── llm-providers
│   ├── config
│   └── observability
└── apps/
    ├── community-bot   ← public, Apache 2.0
    └── cloud-api       ← PRIVATE (v1.0+)
```

## Rationale

- Allows hosting Community (public) and Cloud (private) together without duplicating Zod contracts and business types.
- pnpm deduplicates dependencies via a global store, essential with OTel + Probot + 3 LLM SDKs (significant disk space savings, faster installation).
- Turborepo is minimalist: local + remote cache, easy to learn, minimal configuration (~30 lines of `turbo.json`).
- Workspace protocol (`workspace:*`) guarantees that internal imports always use the local version.
- Cross-package refactoring is trivial: one commit, one PR.

## Consequences

- Slightly heavier initial setup than a single flat repo (~1 hour of configuration).
- Requires discipline on boundaries between packages: a package must not import an internal module from another package, only its public API.
- Private Cloud managed from v1.0+: either `apps/cloud-api/` folder in a separate repo as git submodule, or via `.gitignore` depending on organizational evolution.
- Single pnpm lockfile for the entire project: changing a dependency in one package triggers a global `pnpm install`.

## Rejected alternatives

- **Single flat repo**: duplicates Zod contracts between Community and Cloud, or forces Cloud to depend on an npm package published from Community (slower dev cycle).
- **Separate multi-repo**: painful for shared types, either we publish `@sovri/core` to npm (versioning overhead), or we duplicate.
- **Nx**: over-engineered for this project, many concepts (executors, generators) unnecessary at this scale.
- **Yarn workspaces**: less efficient than pnpm on deduplication, Yarn 4 ecosystem less stable than pnpm 10 in 2026.
- **npm workspaces**: works but slower and less feature-rich than pnpm on hooks and filtering.
