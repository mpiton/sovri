// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Severity } from "../types/Finding.js";

// Higher rank = more severe. blocker (5) > major (4) > minor (3) > info (2) > nitpick (1).
// `satisfies` enforces compile-time exhaustiveness against the Severity union.
const SEVERITY_RANK = {
  blocker: 5,
  major: 4,
  minor: 3,
  info: 2,
  nitpick: 1,
} as const satisfies Record<Severity, number>;

// Numeric rank in the closed interval [1, 5]; 5 = blocker, 1 = nitpick.
export type SeverityRank = (typeof SEVERITY_RANK)[Severity];

/**
 * Maps a `Severity` to a numeric rank suitable for sorting findings by impact.
 * Strictly descending: a higher number means a more severe finding.
 */
export function computeSeverityRank(severity: Severity): SeverityRank {
  return SEVERITY_RANK[severity];
}
