// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

// Resolve every internal @sovri/* import to its TypeScript source entrypoint rather than the
// package's built dist/. Tests then run against current source with no rebuild step, and never
// race a concurrent `turbo build` rewriting dist/ mid-run or read a stale dist from an earlier build.
const workspaceSourceAliases = {
  "@sovri/compliance": fileURLToPath(
    new URL("./packages/compliance/src/index.ts", import.meta.url),
  ),
  "@sovri/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
  "@sovri/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
  "@sovri/llm-providers": fileURLToPath(
    new URL("./packages/llm-providers/src/index.ts", import.meta.url),
  ),
  "@sovri/observability": fileURLToPath(
    new URL("./packages/observability/src/index.ts", import.meta.url),
  ),
  "@sovri/review-engine": fileURLToPath(
    new URL("./packages/review-engine/src/index.ts", import.meta.url),
  ),
};

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: workspaceSourceAliases,
  },
  test: {
    alias: workspaceSourceAliases,
    coverage: {
      exclude: [
        "**/*.test.ts",
        "**/coverage/**",
        "**/dist/**",
        "**/*.config.ts",
        "apps/*/tests/**",
        "packages/*/test/**",
      ],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
    environment: "node",
    // Never descend into gitignored git worktrees: they hold stale duplicate
    // test files that resolve workspace aliases to the live source and break.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    // Vitest globals stay disabled; tests import APIs from vitest.
    globals: false,
  },
});
