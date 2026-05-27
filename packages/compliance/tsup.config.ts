// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: {
    // tsup's dts pass cannot share tsconfig.base's composite/incremental flags;
    // disable them here so only the dts compilation is affected.
    compilerOptions: {
      composite: false,
      incremental: false,
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
});
