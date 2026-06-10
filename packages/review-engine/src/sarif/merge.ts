// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  applyIgnoreRules,
  computeSeverityRank,
  type Diff,
  type Finding,
  type Severity,
} from "@sovri/core";

// LLM findings sort before SARIF at equal severity: the LLM finding is appended
// first and wins a cross-source collision, so it leads the stable order too.
const SOURCE_RANK: Readonly<Record<Finding["source"], number>> = { llm: 0, sarif: 1 };

/**
 * Merge SARIF findings into the LLM findings for one review. SARIF is appended
 * AFTER the LLM findings and deduplicated: a SARIF finding colliding with an LLM
 * finding (same file, same CWE, overlapping lines) collapses to the LLM one, and
 * intra-SARIF / cross-tool duplicates collapse first-wins. Only SARIF findings
 * whose file is in the diff's changed-files set survive (a security gate). The
 * merged set passes the severity threshold and ignore rules, then is ordered by
 * a stable tie-break so golden output is reproducible.
 */
export function mergeSarifFindings(
  llmFindings: readonly Finding[],
  sarifFindings: readonly Finding[],
  diff: Diff,
  severityThreshold: Severity,
  ignores: readonly string[],
): Finding[] {
  const changedFiles = new Set(diff.files.map((file) => file.path));

  const keptSarif: Finding[] = [];
  for (const candidate of sarifFindings) {
    if (!changedFiles.has(candidate.file)) {
      continue;
    }
    const collidesWithLlm = llmFindings.some((other) => collides(other, candidate));
    const collidesWithKept = keptSarif.some((other) => collides(other, candidate));
    if (!collidesWithLlm && !collidesWithKept) {
      keptSarif.push(candidate);
    }
  }

  const merged = [...llmFindings, ...keptSarif];
  const filtered = applyFilters(merged, severityThreshold, ignores);
  return filtered.toSorted(compareFindings);
}

function collides(a: Finding, b: Finding): boolean {
  return (
    a.file === b.file &&
    a.cwe !== undefined &&
    a.cwe === b.cwe &&
    a.line_start <= b.line_end &&
    b.line_start <= a.line_end
  );
}

function applyFilters(
  findings: readonly Finding[],
  severityThreshold: Severity,
  ignores: readonly string[],
): readonly Finding[] {
  const thresholdRank = computeSeverityRank(severityThreshold);
  const bySeverity = findings.filter(
    (finding) => computeSeverityRank(finding.severity) >= thresholdRank,
  );
  return applyIgnoreRules(bySeverity, ignores);
}

function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = computeSeverityRank(b.severity) - computeSeverityRank(a.severity);
  if (bySeverity !== 0) {
    return bySeverity;
  }
  const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (bySource !== 0) {
    return bySource;
  }
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1;
  }
  if (a.line_start !== b.line_start) {
    return a.line_start - b.line_start;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}
