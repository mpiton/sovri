// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { computeSeverityRank, type Finding } from "@sovri/core";

export type EffortScore = 1 | 2 | 3 | 4 | 5;

/**
 * Computes a deterministic review effort score from findings only.
 * Empty reviews score 1; otherwise the score is the highest severity rank present.
 */
export function computeEffortScore(findings: readonly Finding[]): EffortScore {
  let score: EffortScore = 1;

  for (const finding of findings) {
    const rank = computeSeverityRank(finding.severity);
    if (rank > score) {
      score = rank;
    }
    if (score === 5) {
      break;
    }
  }

  return score;
}
