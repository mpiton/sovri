// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";

type Hunk = Diff["files"][number]["hunks"][number];

/**
 * Yield each RIGHT-side (new) line of a hunk with its new-side line number and
 * its text (leading diff prefix stripped). Lines that do not exist on the new
 * side — deletions (`-`) and the "No newline at end of file" marker (`\`) — are
 * skipped, and the counter advances only for kept lines.
 *
 * This is the single definition of the unified-diff new-side line walk; both
 * inline-comment anchoring and finding fingerprinting consume it so the two can
 * never disagree on which new-side line a hunk line maps to.
 */
export function* iterateRightSideLines(hunk: Hunk): Generator<{
  readonly lineNumber: number;
  readonly text: string;
}> {
  let lineNumber = hunk.new_start;

  for (const line of hunk.lines) {
    if (line.startsWith("-") || line.startsWith("\\")) {
      continue;
    }

    yield { lineNumber, text: line.slice(1) };
    lineNumber += 1;
  }
}
