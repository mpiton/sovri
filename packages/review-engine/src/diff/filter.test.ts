// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";
import { describe, expect, it } from "vitest";

type FilterDiffByIgnores = (diff: Diff, patterns: readonly string[]) => Diff;

const FilterModulePath = "./filter.js";
const Sha = "2222222222222222222222222222222222222222";

async function loadFilterDiffByIgnores(): Promise<FilterDiffByIgnores> {
  const module: unknown = await import(FilterModulePath);
  if (!isFilterModule(module)) {
    throw new TypeError("filterDiffByIgnores export is missing");
  }

  return module.filterDiffByIgnores;
}

function isFilterModule(value: unknown): value is { filterDiffByIgnores: FilterDiffByIgnores } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof Reflect.get(value, "filterDiffByIgnores") === "function";
}

function twoFileDiff(): Diff {
  const unifiedDiff = `diff --git a/src/app.ts b/src/app.ts
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 export const enabled = false;
+export const enabled = true;
 export const name = "sovri";
diff --git a/dist/app.js b/dist/app.js
index 3333333333333333333333333333333333333333..2222222222222222222222222222222222222222 100644
--- a/dist/app.js
+++ b/dist/app.js
@@ -1 +1,2 @@
 console.log("old");
+console.log("bundled generated code");`;

  return {
    unified_diff: unifiedDiff,
    files: [
      {
        path: "src/app.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        sha: Sha,
        patch: unifiedDiff.split("diff --git a/dist/app.js b/dist/app.js")[0]?.trimEnd() ?? "",
        hunks: [
          {
            old_start: 1,
            old_lines: 2,
            new_start: 1,
            new_lines: 3,
            header: "@@ -1,2 +1,3 @@",
            lines: [
              " export const enabled = false;",
              "+export const enabled = true;",
              ' export const name = "sovri";',
            ],
          },
        ],
      },
      {
        path: "dist/app.js",
        status: "modified",
        additions: 1,
        deletions: 0,
        sha: Sha,
        patch: `diff --git a/dist/app.js b/dist/app.js\n${
          unifiedDiff.split("diff --git a/dist/app.js b/dist/app.js")[1] ?? ""
        }`.trimEnd(),
        hunks: [
          {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 2,
            header: "@@ -1 +1,2 @@",
            lines: [' console.log("old");', '+console.log("bundled generated code");'],
          },
        ],
      },
    ],
  };
}

describe("filterDiffByIgnores", () => {
  it("keeps every file and patch when ignore patterns are empty", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = twoFileDiff();

    // Given ignore patterns are []
    const patterns: readonly string[] = [];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);

    // Then the returned Diff has files ["src/app.ts", "dist/app.js"]
    expect(filtered.files.map((file) => file.path)).toEqual(["src/app.ts", "dist/app.js"]);
    // And the returned unified_diff still contains "diff --git a/src/app.ts b/src/app.ts"
    expect(filtered.unified_diff).toContain("diff --git a/src/app.ts b/src/app.ts");
    // And the returned unified_diff still contains "diff --git a/dist/app.js b/dist/app.js"
    expect(filtered.unified_diff).toContain("diff --git a/dist/app.js b/dist/app.js");
  });

  it("keeps generated files and their patch content when ignore patterns are empty", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = twoFileDiff();

    // Given ignore patterns are []
    const patterns: readonly string[] = [];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);

    // Then "dist/app.js" is still present in the returned Diff files
    expect(filtered.files.map((file) => file.path)).toContain("dist/app.js");
    // And the returned unified_diff still contains "bundled generated code"
    expect(filtered.unified_diff).toContain("bundled generated code");
  });

  it("returns an equal fresh Diff object without mutating the input when ignore patterns are empty", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = twoFileDiff();

    // Given ignore patterns are []
    const patterns: readonly string[] = [];
    // And the original Diff object is kept for comparison
    const original = structuredClone(diff);

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);

    // Then the returned Diff equals the original Diff by value
    expect(filtered).toEqual(original);
    // And the returned Diff is not the same object reference as the input Diff
    expect(filtered).not.toBe(diff);
    // And the input Diff files remain ["src/app.ts", "dist/app.js"]
    expect(diff.files.map((file) => file.path)).toEqual(["src/app.ts", "dist/app.js"]);
  });
});
