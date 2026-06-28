// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

export interface CataloguedControlReference {
  readonly control_id: string;
  readonly framework?: string;
  readonly framework_reference: string;
  readonly source_url: string;
  readonly remediation_guidance: string;
}

export interface ComplianceGapRenderInput {
  readonly id: string;
  readonly control_id?: string;
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

interface ControlResultRenderInput {
  readonly control_id: string;
  readonly evidence?: string;
  readonly status?: string;
  readonly compliance_gap?: ComplianceGapRenderInput;
}

interface ControlResultPullRequestRenderOptions extends ComplianceGapRenderOptions {
  readonly changed_files: readonly string[];
  readonly relations?: readonly ComplianceGapFileRelation[];
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

  if (control === undefined) {
    return "";
  }

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

  if (control === undefined) {
    return "";
  }

  return [
    "potential compliance gap",
    `Framework reference: ${control.framework_reference}`,
    `Evidence: ${gap.evidence ?? ""}`,
  ].join("\n");
}

export function renderControlResultOutput(
  controlResult: ControlResultRenderInput,
  options: ComplianceGapRenderOptions,
): string {
  if (controlResult.compliance_gap === undefined) {
    return [
      "ControlResult",
      `Status: ${controlResult.status ?? ""}`,
      `Evidence: ${controlResult.evidence ?? ""}`,
    ].join("\n");
  }

  const gap = {
    ...controlResult.compliance_gap,
    control_id: controlResult.compliance_gap.control_id ?? controlResult.control_id,
  };
  const control = findCataloguedControl(gap, options.catalog);

  if (control === undefined) {
    return "";
  }

  return [
    `ComplianceGap: ${gap.id}`,
    "potential compliance gap",
    `Status: ${gap.status ?? controlResult.status ?? ""}`,
    `Severity: ${gap.severity ?? ""}`,
    `Framework: ${control.framework ?? control.framework_reference}`,
    `Framework reference: ${control.framework_reference}`,
    `Control id: ${control.control_id}`,
    `Source URL: ${control.source_url}`,
    `Evidence: ${gap.evidence ?? controlResult.evidence ?? ""}`,
    `Remediation guidance: ${control.remediation_guidance}`,
  ].join("\n");
}

export function renderControlResultPullRequestOutput(
  controlResult: ControlResultRenderInput,
  options: ControlResultPullRequestRenderOptions,
): string {
  const gap = controlResult.compliance_gap;

  if (
    gap === undefined ||
    options.relations?.some(
      (relation) => relation.gap_id === gap.id && options.changed_files.includes(relation.file),
    ) !== true
  ) {
    return "";
  }

  return renderControlResultOutput(controlResult, options);
}

export function renderInternalComplianceDiagnostics(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapRenderOptions,
): string {
  const control = findCataloguedControl(gap, options.catalog);

  if (control !== undefined) {
    return "";
  }

  return [
    "internal compliance diagnostic",
    `Gap id: ${gap.id}`,
    gap.control_id === undefined
      ? "missing catalogued control reference"
      : "uncatalogued control reference",
  ].join("\n");
}

export function evaluateComplianceGapPublishability(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPublishabilityOptions,
): ComplianceGapPublishabilityResult {
  const control = findCataloguedControl(gap, options.catalog);

  if (control === undefined) {
    return {
      publishable: false,
      rejected_gap_id: gap.id,
      output_contract_check: "failed",
      explanation: "regulatory claims require catalogued control references",
    };
  }

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
): CataloguedControlReference | undefined {
  return catalog.find((candidate) => candidate.control_id === gap.control_id);
}

function isRelatedToChangedFile(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPullRequestRenderOptions,
): boolean {
  return options.relations.some(
    (relation) => relation.gap_id === gap.id && options.changed_files.includes(relation.file),
  );
}
