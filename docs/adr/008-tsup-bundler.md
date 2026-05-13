# ADR-008 — tsup as package bundler

**Status:** Accepted
**Date:** 2026-05-12

## Context

Bundling of internal monorepo packages (`packages/core`, `packages/review-engine`, etc.). Bundling allows:

- Producing distributable `.js` files (from `.ts` sources)
- Generating `.d.ts` TypeScript declaration files
- Having clean ESM output files
- Tree-shaking unused dependencies

The `community-bot` app doesn't need bundling for production (Node directly consumes compiled `.js`), but packages do to properly define exports.

Alternatives evaluated: tsup, tsc alone, esbuild, Rollup, unbuild.

## Decision

**tsup for each package** in `packages/*`. Minimal configuration via a `tsup.config.ts` file per package.

`apps/community-bot` uses `tsc` directly (no need for a bundler for a Node app).

## Rationale

- **esbuild wrapper**: ultra fast (sub-second build for a typical package).
- **Minimal configuration**: a 10-line `tsup.config.ts` file per package is enough.
- **ESM only**: aligned with ADR-003.
- **Automatically generates `.d.ts`** via a dedicated option, no separate pipeline needed.
- **Tree-shaking** enabled by default.
- **Tree-shakes internal imports correctly** between packages via `external: [...]`.

## Consequences

- Each package has a standardized `build` script that calls `tsup`.
- The `dist/` of each package contains `index.js` + `index.d.ts`.
- Turborepo (see ADR-002) caches `dist/` outputs per package.
- If we want to publish packages to npm someday, the format is ready.

## Sample configuration

`packages/core/tsup.config.ts`:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
```

## Rejected alternatives

- **tsc alone**: no bundling, no tree-shaking. Works but requires publishing the entire `dist/` tree, less clean public API.
- **Raw esbuild**: tsup is already an esbuild wrapper with sensible preconfigured options. No reason to reinvent.
- **Rollup**: more configurable but more complex and slower. Oversized for this project.
- **unbuild**: recent alternative (Nuxt ecosystem), less battle-tested than tsup in 2026.
