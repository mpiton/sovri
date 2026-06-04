// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { computeSeverityRank, type Finding, type Severity } from "@sovri/core";

import { severityBadge } from "./badge.js";

export type EffortScore = 1 | 2 | 3 | 4 | 5;

const FILLED_DOT = "●";
const EMPTY_DOT = "○";
const BLOCK_BAR_GLYPH = "█";
const EFFORT_METER_DOTS = 5;
const VOLUME_BONUS_THRESHOLD = 4;
const CONFIDENCE_BONUS_THRESHOLD = 0.85;
const CONFIDENCE_BOUNDARY_EPSILON = Number.EPSILON * 10;
const SEVERITY_ORDER: readonly Severity[] = ["blocker", "major", "minor", "info", "nitpick"];

type SeverityCount = {
  readonly severity: Severity;
  readonly count: number;
};

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

export function renderSeverityDistribution(findings: readonly Finding[]): readonly string[] {
  if (findings.length === 0) {
    return [];
  }

  const severityRows = collectSeverityRows(countSeverities(findings));

  return [
    `Total: ${formatCount(findings.length, "finding", "findings")}`,
    `Bar: ${renderSeverityBar(severityRows)}`,
    ...severityRows.map(renderSeverityLegendRow),
  ];
}

function meetsConfidenceThreshold(averageConfidence: number): boolean {
  return averageConfidence + CONFIDENCE_BOUNDARY_EPSILON >= CONFIDENCE_BONUS_THRESHOLD;
}

function countSeverities(findings: readonly Finding[]): Map<Severity, number> {
  const counts = new Map<Severity, number>();

  for (const severity of SEVERITY_ORDER) {
    counts.set(severity, 0);
  }

  for (const finding of findings) {
    counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  }

  return counts;
}

function collectSeverityRows(counts: ReadonlyMap<Severity, number>): SeverityCount[] {
  const rows: SeverityCount[] = [];

  for (const severity of SEVERITY_ORDER) {
    const count = counts.get(severity) ?? 0;
    if (count > 0) {
      rows.push({ severity, count });
    }
  }

  return rows;
}

function renderSeverityBar(rows: readonly SeverityCount[]): string {
  return rows.map((row) => BLOCK_BAR_GLYPH.repeat(row.count)).join("");
}

function renderSeverityLegendRow(row: SeverityCount): string {
  return `- ${severityBadge(row.severity)} ${row.severity}: ${formatCount(
    row.count,
    "finding",
    "findings",
  )}`;
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
