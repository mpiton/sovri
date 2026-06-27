// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { enrichFindingCompliance } from "@sovri/compliance";
import type { Finding } from "@sovri/core";

import type {
  CataloguedControlReference,
  ComplianceGapRenderInput,
} from "./compliance-gap-rendering.js";

export interface FindingOutputContractOptions {
  readonly rendered_finding: RenderedFindingOutput;
}

export interface RenderedFindingOutput {
  readonly id?: string;
  readonly kind?: string;
  readonly cwe?: string;
  readonly control_id?: string;
}

export interface FindingOutputContractResult {
  readonly output_contract_check: "passed" | "failed";
  readonly rejected_finding_id?: string;
  readonly reason?: string;
  readonly explanation?: string;
}

export interface CombinedReviewOutputModelInput {
  readonly findings: readonly Finding[];
  readonly compliance_gaps: readonly ComplianceGapRenderInput[];
  readonly catalog: readonly CataloguedControlReference[];
}

export interface CombinedReviewOutputModel {
  readonly items: readonly CombinedReviewOutputItem[];
}

export interface CombinedReviewOutputItem {
  readonly id: string;
  readonly path: "Finding enrichment path" | "ComplianceGap output contract";
  readonly reference_labels: readonly string[];
}

export function evaluateFindingOutputContract(
  finding: Finding,
  options: FindingOutputContractOptions,
): FindingOutputContractResult {
  if (options.rendered_finding.kind === "ComplianceGap") {
    return failedFindingContract(
      finding,
      "finding rendered only as a ComplianceGap",
      "CWE-backed Findings must stay on the Finding enrichment path",
    );
  }

  if (finding.cwe !== undefined && options.rendered_finding.cwe !== finding.cwe) {
    return failedFindingContract(
      finding,
      "CWE enrichment was lost",
      "CWE-backed Findings must keep their CWE in review output",
    );
  }

  return { output_contract_check: "passed" };
}

export function buildCombinedReviewOutputModel(
  input: CombinedReviewOutputModelInput,
): CombinedReviewOutputModel {
  return {
    items: [
      ...input.findings.map(buildFindingOutputItem),
      ...input.compliance_gaps.map((gap) => buildComplianceGapOutputItem(gap, input.catalog)),
    ],
  };
}

function buildFindingOutputItem(finding: Finding): CombinedReviewOutputItem {
  const enrichedFinding = enrichFindingCompliance(finding);

  return {
    id: finding.id,
    path: "Finding enrichment path",
    reference_labels: enrichedFinding.compliance_references.map((reference) =>
      [reference.framework, reference.identifier].join(" "),
    ),
  };
}

function buildComplianceGapOutputItem(
  gap: ComplianceGapRenderInput,
  catalog: readonly CataloguedControlReference[],
): CombinedReviewOutputItem {
  const control = catalog.find((candidate) => candidate.control_id === gap.control_id);

  return {
    id: gap.id,
    path: "ComplianceGap output contract",
    reference_labels: control === undefined ? [] : [control.framework_reference],
  };
}

function failedFindingContract(
  finding: Finding,
  reason: string,
  explanation: string,
): FindingOutputContractResult {
  return {
    output_contract_check: "failed",
    rejected_finding_id: finding.id,
    reason,
    explanation,
  };
}
