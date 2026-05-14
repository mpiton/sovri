// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding } from "../types/Finding.js";

// Locale-independent ascending code-point comparator. Exported so the
// three-way contract (must return 0 for equal pairs) can be exhaustively
// tested even though `groupFindingsByFile` only ever feeds it unique keys.
export function compareFilePaths(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Groups findings by their `file` field.
 *
 * - Keys appear in ascending order via locale-independent code-point comparison.
 * - Findings within a group preserve their original input order.
 * - The input array and individual findings are never mutated.
 * - The returned record is typed as deeply readonly to prevent downstream
 *   consumers from mutating the buckets and corrupting shared views.
 */
export function groupFindingsByFile(
  findings: readonly Finding[],
): Readonly<Record<string, readonly Finding[]>> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.file);
    if (bucket === undefined) {
      groups.set(finding.file, [finding]);
    } else {
      bucket.push(finding);
    }
  }
  const sortedEntries = [...groups.entries()].toSorted(([a], [b]) => compareFilePaths(a, b));
  return Object.fromEntries(sortedEntries);
}
