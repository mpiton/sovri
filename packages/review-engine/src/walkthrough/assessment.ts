// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { computeSeverityRank, type Finding } from "@sovri/core";

export type EffortScore = 1 | 2 | 3 | 4 | 5;

const FILLED_DOT = "●";
const EMPTY_DOT = "○";
const EFFORT_METER_DOTS = 5;
const VOLUME_BONUS_THRESHOLD = 4;
const CONFIDENCE_BONUS_THRESHOLD = 0.85;
const CONFIDENCE_BOUNDARY_EPSILON = Number.EPSILON * 10;

/**
 * Computes a deterministic review effort score from findings only.
 * Empty reviews score 1; otherwise the score is highest severity rank plus
 * volume and confidence bonuses, clamped to the visible 1..5 meter.
 */
export function computeEffortScore(findings: readonly Finding[]): EffortScore {
  if (findings.length === 0) {
    return 1;
  }

  let highestSeverityRank = 1;
  let confidenceTotal = 0;

  for (const finding of findings) {
    confidenceTotal += finding.confidence;
    const rank = computeSeverityRank(finding.severity);
    if (rank > highestSeverityRank) {
      highestSeverityRank = rank;
    }
    if (highestSeverityRank === 5) {
      return 5;
    }
  }

  const volumeBonus = findings.length >= VOLUME_BONUS_THRESHOLD ? 1 : 0;
  const averageConfidence = confidenceTotal / findings.length;
  const confidenceBonus = meetsConfidenceThreshold(averageConfidence) ? 1 : 0;

  return toEffortScore(highestSeverityRank + volumeBonus + confidenceBonus);
}

export function renderEffortMeter(score: EffortScore): string {
  return FILLED_DOT.repeat(score) + EMPTY_DOT.repeat(EFFORT_METER_DOTS - score);
}

export function renderMetricChips(findings: readonly Finding[]): string {
  const touchedFiles = new Set(findings.map((finding) => finding.file));
  const highImpactFindings = findings.filter(
    (finding) => computeSeverityRank(finding.severity) >= 4,
  );

  return [
    renderMetricChip(formatCount(findings.length, "finding", "findings")),
    renderMetricChip(formatCount(touchedFiles.size, "file touched", "files touched")),
    renderMetricChip(
      formatCount(
        highImpactFindings.length,
        "blocker plus major finding",
        "blocker plus major findings",
      ),
    ),
  ].join(" · ");
}

function meetsConfidenceThreshold(averageConfidence: number): boolean {
  return averageConfidence + CONFIDENCE_BOUNDARY_EPSILON >= CONFIDENCE_BONUS_THRESHOLD;
}

function renderMetricChip(label: string): string {
  return `\`${label}\``;
}

function formatCount(count: number, singular: string, plural: string): string {
  const label = count === 1 ? singular : plural;
  return `${count} ${label}`;
}

function toEffortScore(rawScore: number): EffortScore {
  if (rawScore <= 1) {
    return 1;
  }
  if (rawScore === 2) {
    return 2;
  }
  if (rawScore === 3) {
    return 3;
  }
  if (rawScore === 4) {
    return 4;
  }
  return 5;
}
