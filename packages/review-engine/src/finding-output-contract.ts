// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { enrichFindingCompliance } from "@sovri/compliance";
import type { Finding } from "@sovri/core";

import type {
  CataloguedControlReference,
  ComplianceGapRenderInput,
} from "./compliance-gap-rendering.js";
import { shouldEnrichCompliance } from "./compliance-gate.js";

const CwePattern = /^CWE-\d+$/u;

export interface FindingOutputContractOptions {
  readonly rendered_finding: RenderedFindingOutput;
}

export interface RenderedFindingOutput {
  readonly id: string;
  readonly cwe?: string;
  readonly control_id?: string;
  readonly reference_labels?: readonly string[];
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
  const renderedFinding = (options as Partial<FindingOutputContractOptions> | undefined)
    ?.rendered_finding;

  if (!isRenderedFindingOutput(renderedFinding)) {
    return failedFindingContract(
      finding,
      "rendered finding is malformed",
      "Finding output contract checks require a rendered Finding object with an id",
    );
  }

  if (renderedFinding.id !== finding.id) {
    return failedFindingContract(
      finding,
      "rendered finding id mismatch",
      "Finding output contract checks require the rendered Finding id to match the source Finding",
    );
  }

  if (isRenderedComplianceGap(renderedFinding)) {
    return failedFindingContract(
      finding,
      "finding rendered only as a ComplianceGap",
      "CWE-backed Findings must stay on the Finding enrichment path",
    );
  }

  if (!hasMatchingCwe(finding, renderedFinding)) {
    return failedFindingContract(
      finding,
      "CWE enrichment changed",
      "Finding output must preserve the source Finding CWE state and value",
    );
  }

  if (!hasRenderedComplianceReferences(finding, renderedFinding)) {
    return failedFindingContract(
      finding,
      "compliance references were lost",
      "CWE-backed Findings must render the compliance references from the Finding enrichment path",
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
  const referenceLabels = referenceLabelsFor(enrichedFinding);

  if (referenceLabels.length === 0) {
    return [];
  }

  return [
    {
      id: finding.id,
      path: "Finding enrichment path",
      reference_labels: referenceLabels,
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
  return renderedFinding.control_id !== undefined;
}

function hasMatchingCwe(finding: Finding, renderedFinding: RenderedFindingOutput): boolean {
  if (!hasValidOptionalCwe(finding.cwe) || !hasValidOptionalCwe(renderedFinding.cwe)) {
    return false;
  }

  return renderedFinding.cwe === finding.cwe;
}

function hasRenderedComplianceReferences(
  finding: Finding,
  renderedFinding: RenderedFindingOutput,
): boolean {
  const expectedLabels = shouldEnrichCompliance(finding)
    ? referenceLabelsFor(enrichFindingCompliance(finding))
    : [];

  if (expectedLabels.length === 0) {
    return (
      renderedFinding.reference_labels === undefined ||
      renderedFinding.reference_labels.length === 0
    );
  }

  return expectedLabels.every((expectedLabel) =>
    (renderedFinding.reference_labels ?? []).includes(expectedLabel),
  );
}

function hasValidOptionalCwe(cwe: string | undefined): boolean {
  return cwe === undefined || CwePattern.test(cwe);
}

function isRenderedFindingOutput(value: unknown): value is RenderedFindingOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const cwe = Reflect.get(value, "cwe");
  const controlId = Reflect.get(value, "control_id");

  return (
    typeof Reflect.get(value, "id") === "string" &&
    (cwe === undefined || typeof cwe === "string") &&
    (controlId === undefined || typeof controlId === "string") &&
    isOptionalStringArray(Reflect.get(value, "reference_labels"))
  );
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function referenceLabelsFor(finding: Finding): readonly string[] {
  return finding.compliance_references.map((reference) =>
    [reference.framework, reference.identifier].join(" "),
  );
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
