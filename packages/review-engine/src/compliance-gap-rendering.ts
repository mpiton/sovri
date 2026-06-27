// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

interface CataloguedControlReference {
  readonly control_id: string;
  readonly framework_reference: string;
  readonly source_url: string;
  readonly remediation_guidance: string;
}

interface ComplianceGapRenderInput {
  readonly id: string;
  readonly control_id: string;
  readonly evidence?: string;
  readonly status?: string;
  readonly severity?: string;
  readonly cwe?: string;
}

interface ComplianceGapRenderOptions {
  readonly catalog: readonly CataloguedControlReference[];
}

interface ComplianceGapPullRequestRenderOptions extends ComplianceGapRenderOptions {
  readonly changed_files: readonly string[];
  readonly relations: readonly ComplianceGapFileRelation[];
}

interface ComplianceGapFileRelation {
  readonly gap_id: string;
  readonly file: string;
}

interface ComplianceGapPublishabilityOptions extends ComplianceGapRenderOptions {
  readonly renderer_requires_cwe?: boolean;
}

export interface ComplianceGapPublishabilityResult {
  readonly publishable: boolean;
  readonly rejected_gap_id?: string;
  readonly reason?: string;
  readonly output_contract_check: "passed" | "failed";
  readonly explanation?: string;
}

export function renderComplianceGapProjectReportOutput(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapRenderOptions,
): string {
  const control = findCataloguedControl(gap, options.catalog);

  return [
    "potential compliance gap",
    `Framework reference: ${control.framework_reference}`,
    `Source URL: ${control.source_url}`,
    `Control id: ${control.control_id}`,
  ].join("\n");
}

export function renderComplianceGapPullRequestOutput(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPullRequestRenderOptions,
): string {
  if (!isRelatedToChangedFile(gap, options)) {
    return "";
  }

  const control = findCataloguedControl(gap, options.catalog);

  return [
    "potential compliance gap",
    `Framework reference: ${control.framework_reference}`,
    `Evidence: ${gap.evidence ?? ""}`,
  ].join("\n");
}

export function evaluateComplianceGapPublishability(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPublishabilityOptions,
): ComplianceGapPublishabilityResult {
  findCataloguedControl(gap, options.catalog);

  if (options.renderer_requires_cwe === true && gap.cwe === undefined) {
    return {
      publishable: false,
      rejected_gap_id: gap.id,
      reason: "CWE is absent",
      output_contract_check: "failed",
      explanation: "catalogued control references can render without a CWE",
    };
  }

  return {
    publishable: true,
    output_contract_check: "passed",
  };
}

function findCataloguedControl(
  gap: ComplianceGapRenderInput,
  catalog: readonly CataloguedControlReference[],
): CataloguedControlReference {
  const control = catalog.find((candidate) => candidate.control_id === gap.control_id);

  if (control === undefined) {
    throw new Error(`Catalogued control not found: ${gap.control_id}`);
  }

  return control;
}

function isRelatedToChangedFile(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPullRequestRenderOptions,
): boolean {
  return options.relations.some(
    (relation) => relation.gap_id === gap.id && options.changed_files.includes(relation.file),
  );
}
