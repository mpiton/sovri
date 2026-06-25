// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { COMPLIANCE_MIN_CONFIDENCE, type Category, type Finding } from "@sovri/core";

import type { ProviderFinding } from "./parsing/index.js";

// Compliance enrichment is gated to the security and bug categories. Since the compliance pivot
// (ADR-021, MAT-76) the Category enum is exactly this set, so the allowlist now mirrors the whole
// taxonomy and stands as defense-in-depth should a non-compliance category ever be reintroduced.
// CWE presence is not gated here: an eligible finding with no model CWE still passes so the enricher
// can derive one from its signals (ADR-020).
const COMPLIANCE_ELIGIBLE_CATEGORIES: ReadonlySet<Category> = new Set(["security", "bug"]);

export function shouldEnrichCompliance(finding: ProviderFinding): boolean {
  return (
    COMPLIANCE_ELIGIBLE_CATEGORIES.has(finding.category) &&
    finding.confidence >= COMPLIANCE_MIN_CONFIDENCE
  );
}

export interface PartitionedComplianceFindings {
  readonly kept: readonly Finding[];
  readonly droppedCount: number;
}

/**
 * Compliance-only publication gate (MAT-75). After enrichment, Sovri publishes a finding only when it
 * carries at least one compliance reference — its CWE mapped to a regulatory framework (CWE, GDPR,
 * DORA, NIS2, ...). A finding with an empty `compliance_references` is generic review noise with no
 * audit-relevant anchor, so it is dropped before it reaches the pull request.
 *
 * The gate is uniform: it treats LLM and SARIF findings alike, keying solely on whether enrichment
 * produced a mapping — never on the finding's source. Retained findings are returned untouched, so
 * each keeps its `audit_reference`. The dropped count is returned so the orchestrator can log the
 * reduction rather than truncating silently.
 */
export function partitionComplianceMappedFindings(
  findings: readonly Finding[],
): PartitionedComplianceFindings {
  const kept = findings.filter((finding) => finding.compliance_references.length > 0);

  return { kept, droppedCount: findings.length - kept.length };
}
