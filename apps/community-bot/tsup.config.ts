// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/app.ts", "src/server.ts"],
  format: ["esm"],
  dts: {
    compilerOptions: {
      composite: false,
      ignoreDeprecations: "6.0",
      incremental: false,
    },
  },
  clean: true,
  skipNodeModulesBundle: true,
  sourcemap: true,
  treeshake: true,
});
