<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Sovri SAS
-->

# `@sovri/core`

Pure domain layer for Sovri. Types and Zod schemas only — **zero I/O**, no
filesystem, no network, no environment access. All future Sovri packages will
depend on `@sovri/core` and on nothing else from this monorepo; `@sovri/core`
itself depends only on `zod`.

## Scope

- Branded primitives, ids, severity levels, finding shapes
- Zod schemas as the runtime source of truth (`z.infer` derives the TS types)
- Pure helpers that operate only on plain values

Out of scope: GitHub clients, LLM providers, file I/O, env reads, logging.
Those will live in `packages/observability`, `packages/llm-providers`, etc.

## Build wiring

The package's scripts (`build`, `test`, `lint`, `typecheck`) are designed to
be invoked from the workspace root via `pnpm --filter @sovri/core <script>`
or via the matching Turborepo pipeline (`pnpm turbo run <script>`). Running
them directly from the package directory works only inside a `pnpm exec`
shell — `cd packages/core && tsc` will fail unless TypeScript happens to be
installed globally, because the binaries resolve through the workspace's
pnpm symlink tree rather than a per-package devDep.

## References

- `docs/adr/005-zod-runtime-validation.md` — runtime validation policy
- `docs/adr/008-tsup-bundler.md` — bundler choice and tsup config shape
- `docs/adr/010-licence-apache-2.md` — licensing model and header rule
