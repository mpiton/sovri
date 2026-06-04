// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";
import { posix } from "node:path";
import { splitFilePatches } from "./split-file-patches.js";

export function filterDiffByIgnores(diff: Diff, patterns: readonly string[]): Diff {
  if (patterns.length === 0) {
    return { ...diff, files: [...diff.files] };
  }

  const filePatches = splitFilePatches(diff.unified_diff);
  const files = [];
  const patches = [];

  for (const [index, file] of diff.files.entries()) {
    if (matchesAny(file.path, patterns)) {
      continue;
    }

    files.push(file);
    const patch = filePatches[index];
    if (patch !== undefined) {
      patches.push(patch);
    }
  }

  if (files.length === diff.files.length) {
    return { ...diff, files: [...diff.files] };
  }

  return {
    ...diff,
    unified_diff: patches.join("\n"),
    files,
  };
}

function matchesAny(filePath: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (posix.matchesGlob(filePath, pattern)) {
      return true;
    }
  }

  return false;
}
