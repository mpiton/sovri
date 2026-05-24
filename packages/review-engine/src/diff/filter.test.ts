// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";
import { describe, expect, it, vi } from "vitest";

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

function emptyDiff(): Diff {
  return {
    unified_diff: "",
    files: [],
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

  it("keeps an empty Diff empty when ignore patterns are present", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();

    // Given a Diff with unified_diff "" and no files
    const diff = emptyDiff();
    // And ignore patterns are ["dist/**"]
    const patterns: readonly string[] = ["dist/**"];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);

    // Then the returned Diff has no files
    expect(filtered.files).toEqual([]);
    // And the returned unified_diff is ""
    expect(filtered.unified_diff).toBe("");
  });

  it("returns equal filtered output for repeated calls with the same input", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = twoFileDiff();

    // Given ignore patterns are ["dist/**", "coverage/**"]
    const patterns: readonly string[] = ["dist/**", "coverage/**"];

    // When filterDiffByIgnores receives the same Diff and patterns twice
    const first = filterDiffByIgnores(diff, patterns);
    const second = filterDiffByIgnores(diff, patterns);

    // Then both returned Diff values are equal
    expect(first).toEqual(second);
    // And both returned Diff values contain only "src/app.ts"
    expect(first.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(second.files.map((file) => file.path)).toEqual(["src/app.ts"]);
  });

  it("does not depend on environment variables when filtering", async () => {
    const previousOverride = process.env.SOVRI_IGNORE_OVERRIDE;
    process.env.SOVRI_IGNORE_OVERRIDE = "src/**";

    try {
      vi.resetModules();
      const filterDiffByIgnores = await loadFilterDiffByIgnores();
      const diff = twoFileDiff();

      // Given process.env.SOVRI_IGNORE_OVERRIDE is set to "src/**" for the test process
      // And ignore patterns are ["dist/**"]
      const patterns: readonly string[] = ["dist/**"];

      // When filterDiffByIgnores receives the Diff and the patterns
      const filtered = filterDiffByIgnores(diff, patterns);
      const returnedPaths = filtered.files.map((file) => file.path);

      // Then "src/app.ts" remains in the returned Diff
      expect(returnedPaths).toContain("src/app.ts");
      // And "dist/app.js" is removed from the returned Diff
      expect(returnedPaths).not.toContain("dist/app.js");
    } finally {
      if (previousOverride === undefined) {
        delete process.env.SOVRI_IGNORE_OVERRIDE;
      } else {
        process.env.SOVRI_IGNORE_OVERRIDE = previousOverride;
      }
      vi.resetModules();
    }
  });
});
