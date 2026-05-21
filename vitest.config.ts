// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

const workspaceSourceAliases = {
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
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
    environment: "node",
    // Vitest globals stay disabled; tests import APIs from vitest.
    globals: false,
  },
});
