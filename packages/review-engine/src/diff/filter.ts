// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";

export function filterDiffByIgnores(diff: Diff, patterns: readonly string[]): Diff {
  if (patterns.length === 0) {
    return { ...diff, files: [...diff.files] };
  }

  return { ...diff, files: [...diff.files] };
}
