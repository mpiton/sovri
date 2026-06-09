// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  // Bin-only package: no public type surface, so skip the dts pass.
  dts: false,
  clean: true,
  skipNodeModulesBundle: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
});
