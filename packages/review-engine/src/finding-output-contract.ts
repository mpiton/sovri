// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { enrichFindingCompliance } from "@sovri/compliance";
import type { Finding } from "@sovri/core";

import type {
  CataloguedControlReference,
  ComplianceGapRenderInput,
} from "./compliance-gap-rendering.js";
import { shouldEnrichCompliance } from "./compliance-gate.js";

export interface FindingOutputContractOptions {
  readonly rendered_finding: RenderedFindingOutput;
}

export interface RenderedFindingOutput {
  readonly id: string;
  readonly kind?: "Finding" | "ComplianceGap";
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
  if (options.rendered_finding.id !== finding.id) {
    return failedFindingContract(
      finding,
      "rendered finding id mismatch",
      "Finding output contract checks require the rendered Finding id to match the source Finding",
    );
  }

  if (isRenderedComplianceGap(options.rendered_finding)) {
    return failedFindingContract(
      finding,
      "finding rendered only as a ComplianceGap",
      "CWE-backed Findings must stay on the Finding enrichment path",
    );
  }

  if (!hasMatchingCwe(finding, options.rendered_finding)) {
    return failedFindingContract(
      finding,
      "CWE enrichment changed",
      "Finding output must preserve the source Finding CWE state and value",
    );
  }

  return { output_contract_check: "passed" };
}

export function buildCombinedReviewOutputModel(
  input: CombinedReviewOutputModelInput,
): CombinedReviewOutputModel {
  return {
    items: [
      ...input.findings.flatMap(buildFindingOutputItems),
      ...input.compliance_gaps.flatMap((gap) => buildComplianceGapOutputItems(gap, input.catalog)),
    ],
  };
}

function buildFindingOutputItems(finding: Finding): readonly CombinedReviewOutputItem[] {
  if (!shouldEnrichCompliance(finding)) {
    return [];
  }

  const enrichedFinding = enrichFindingCompliance(finding);

  if (enrichedFinding.compliance_references.length === 0) {
    return [];
  }

  return [
    {
      id: finding.id,
      path: "Finding enrichment path",
      reference_labels: enrichedFinding.compliance_references.map((reference) =>
        [reference.framework, reference.identifier].join(" "),
      ),
    },
  ];
}

function buildComplianceGapOutputItems(
  gap: ComplianceGapRenderInput,
  catalog: readonly CataloguedControlReference[],
): readonly CombinedReviewOutputItem[] {
  const control = catalog.find((candidate) => candidate.control_id === gap.control_id);

  if (control === undefined) {
    return [];
  }

  return [
    {
      id: gap.id,
      path: "ComplianceGap output contract",
      reference_labels: [control.framework_reference],
    },
  ];
}

function isRenderedComplianceGap(renderedFinding: RenderedFindingOutput): boolean {
  return renderedFinding.kind === "ComplianceGap" || renderedFinding.control_id !== undefined;
}

function hasMatchingCwe(finding: Finding, renderedFinding: RenderedFindingOutput): boolean {
  if (finding.cwe === undefined) {
    return renderedFinding.cwe === undefined;
  }

  return renderedFinding.cwe === finding.cwe;
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
