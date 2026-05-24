// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, FileChange } from "@sovri/core";
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

function directoryGlobDiff(): Diff {
  const base = twoFileDiff();

  return {
    unified_diff: renameDirectoryGlobPaths(base.unified_diff),
    files: base.files.map(renameDirectoryGlobFile),
  };
}

function diffWithPaths(paths: readonly string[]): Diff {
  const patches = paths.map(createPatch);

  return {
    unified_diff: patches.join("\n"),
    files: paths.map((path, index) => createFileChange(path, patches[index] ?? "")),
  };
}

function createPatch(path: string): string {
  return `diff --git a/${path} b/${path}
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1,2 @@
 old content
+new content for ${path}`;
}

function createFileChange(path: string, patch: string): FileChange {
  return {
    path,
    previous_path: undefined,
    status: "modified",
    additions: 1,
    deletions: 0,
    sha: Sha,
    patch,
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 2,
        header: "@@ -1 +1,2 @@",
        lines: [" old content", `+new content for ${path}`],
      },
    ],
  };
}

function renameDirectoryGlobFile(file: FileChange): FileChange {
  return {
    path: renameDirectoryGlobPath(file.path),
    previous_path:
      file.previous_path === undefined ? undefined : renameDirectoryGlobPath(file.previous_path),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    sha: file.sha,
    patch: file.patch === null ? null : renameDirectoryGlobPaths(file.patch),
    hunks: file.hunks,
  };
}

function renameDirectoryGlobPaths(value: string): string {
  return value
    .replaceAll("src/app.ts", "src/domain/review.ts")
    .replaceAll("dist/app.js", "dist/community-bot.js");
}

function renameDirectoryGlobPath(path: string): string {
  if (path === "src/app.ts") {
    return "src/domain/review.ts";
  }

  if (path === "dist/app.js") {
    return "dist/community-bot.js";
  }

  return path;
}

function getFile(diff: Diff, path: string) {
  const file = diff.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new TypeError(`Missing fixture file: ${path}`);
  }

  return file;
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

  it("does not mutate surviving file objects while filtering", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = twoFileDiff();

    // Given ignore patterns are ["dist/**"]
    const patterns: readonly string[] = ["dist/**"];
    // And the original FileChange object for "src/app.ts" is kept for comparison
    const originalFile = structuredClone(getFile(diff, "src/app.ts"));

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);

    // Then the returned FileChange for "src/app.ts" equals the original FileChange by value
    expect(getFile(filtered, "src/app.ts")).toEqual(originalFile);
    // And the original input Diff files still include "dist/app.js"
    expect(diff.files.map((file) => file.path)).toContain("dist/app.js");
  });

  it("removes generated descendants with a directory glob", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = directoryGlobDiff();

    // Given ignore patterns are ["dist/**"]
    const patterns: readonly string[] = ["dist/**"];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);
    const returnedPaths = filtered.files.map((file) => file.path);

    // Then "dist/community-bot.js" is removed from the returned Diff
    expect(returnedPaths).not.toContain("dist/community-bot.js");
    // And "src/domain/review.ts" remains in the returned Diff
    expect(returnedPaths).toContain("src/domain/review.ts");
  });

  it.each([
    ["*.lock", "app.lock", "pnpm-lock.yaml"],
    ["**/*.lock", "app.lock", "pnpm-lock.yaml"],
    ["{src,lib}/**", "src/domain/review.ts", "README.md"],
    ["!(dist)/**", "src/domain/review.ts", "dist/community-bot.js"],
  ])("applies Node POSIX glob pattern %s literally", async (pattern, removedPath, keptPath) => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = diffWithPaths([removedPath, keptPath]);

    // Given ignore patterns are ["<pattern>"]
    const patterns: readonly string[] = [pattern];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);
    const returnedPaths = filtered.files.map((file) => file.path);

    // Then "<removed_path>" is removed from the returned Diff
    expect(returnedPaths).not.toContain(removedPath);
    // And "<kept_path>" remains in the returned Diff
    expect(returnedPaths).toContain(keptPath);
  });

  it("does not treat a leading bang as gitignore negation", async () => {
    const filterDiffByIgnores = await loadFilterDiffByIgnores();
    const diff = directoryGlobDiff();

    // Given ignore patterns are ["!dist/**"]
    const patterns: readonly string[] = ["!dist/**"];

    // When filterDiffByIgnores receives the Diff and the patterns
    const filtered = filterDiffByIgnores(diff, patterns);
    const returnedPaths = filtered.files.map((file) => file.path);

    // Then "dist/community-bot.js" remains in the returned Diff
    expect(returnedPaths).toContain("dist/community-bot.js");
    // And no file is removed because node:path.posix.matchesGlob does not treat a leading "!" as pattern negation
    expect(returnedPaths).toEqual(diff.files.map((file) => file.path));
  });
});
