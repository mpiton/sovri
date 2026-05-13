# ADR-003 — ESM only, no CommonJS

**Status:** Accepted
**Date:** 2026-05-12

## Context

Choice of module system for the project. The JavaScript ecosystem has two systems: CommonJS (historical, `require`/`module.exports`) and ECMAScript Modules (ESM, standard, `import`/`export`). By 2026, the ecosystem has largely shifted to ESM. Node 24 supports ESM natively without flags.

## Decision

**ESM only, no CommonJS, no dual package.**

All `package.json` files have:

```json
{
  "type": "module"
}
```

All TypeScript imports use the `.js` extension at the end (TS ESM convention):

```typescript
import { Logger } from "./logger.js"; // not './logger'
```

## Rationale

- **Mistral SDK v2 is ESM-only**: the official SDK made this choice in 2026, we align with it.
- **Anthropic SDK supports ESM**: importable natively.
- **Probot v14 supports ESM**: the GitHub App framework works in pure ESM.
- **Node 24 supports ESM natively**: no `--experimental-modules` flag, no boilerplate.
- **Avoids dual package**: maintaining both CJS and ESM doubles potential bugs (`__dirname`, paths, etc.) with no benefit for a server project.
- **Aligned with the 2026 ecosystem**: nearly all dev tooling packages have moved ESM-first.

## Consequences

- All `package.json` files have `"type": "module"`.
- All imports end with `.js` (even in TypeScript, by TS ESM 5.x convention).
- A few historically CommonJS third-party packages require `await import()` or a wrapper. Rare case in 2026.
- Vitest tests work natively in ESM (see ADR-007).
- No `require()` allowed except in documented exceptional cases with a comment.

## Rejected alternatives

- **CommonJS only**: too dated for 2026, forces using wrappers for modern ESM-only SDKs (Mistral v2).
- **Dual package CJS + ESM**: doubles potential bugs (`__dirname`, conditional exports), build overhead, little benefit server-side.
