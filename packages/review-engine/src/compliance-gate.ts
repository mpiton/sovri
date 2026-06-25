// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { COMPLIANCE_MIN_CONFIDENCE, type Finding } from "@sovri/core";

import type { ProviderFinding } from "./parsing/index.js";

// Compliance enrichment is gated on confidence alone (MAT-77). The finding Category enum is now
// scoped to the compliance perimeter — `bug`, `security`, and `compliance` are all compliance-
// eligible (ADR-013, ADR-021) — so there is no longer a category to exclude; only a low-confidence
// finding is withheld here. CWE presence is not gated either: an eligible finding with no model CWE
// still passes so the enricher can derive one from its signals (ADR-020).
export function shouldEnrichCompliance(finding: ProviderFinding): boolean {
  return finding.confidence >= COMPLIANCE_MIN_CONFIDENCE;
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
