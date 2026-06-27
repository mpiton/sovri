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
  readonly changed_files?: readonly string[];
  readonly changed_routes?: readonly string[];
  readonly changed_dependencies?: readonly string[];
  readonly relations: readonly ComplianceGapRelation[];
}

interface ComplianceGapPullRequestProjectionOptions extends ComplianceGapRenderOptions {
  readonly changed_files?: readonly string[];
  readonly changed_routes?: readonly string[];
  readonly changed_dependencies?: readonly string[];
  readonly relations?: readonly ComplianceGapRelation[];
}

interface ComplianceGapPullRequestProjectionEvaluationOptions extends ComplianceGapPullRequestProjectionOptions {
  readonly pull_request_output?: string;
}

interface ComplianceGapRelation {
  readonly gap_id: string;
  readonly file?: string;
  readonly route?: string;
  readonly dependency?: string;
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

export interface ComplianceGapPullRequestProjectionEvaluationResult {
  readonly output_contract_check: "passed" | "failed";
  readonly rejected_gap_id?: string;
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
  if (!isRelatedToChangedEntity(gap, options)) {
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

export function renderComplianceGapProjectReportProjection(
  gaps: readonly ComplianceGapRenderInput[],
  options: ComplianceGapRenderOptions,
): string {
  return gaps
    .map((gap) => renderProjectReportProjectionItem(gap, options))
    .filter((output) => output.length > 0)
    .join("\n\n");
}

export function renderComplianceGapPullRequestProjection(
  gaps: readonly ComplianceGapRenderInput[],
  options: ComplianceGapPullRequestProjectionOptions,
): string {
  if (options.relations === undefined) {
    return "";
  }

  const renderOptions = buildPullRequestRenderOptions(options, options.relations);

  return gaps
    .map((gap) => renderPullRequestProjectionItem(gap, renderOptions))
    .filter((output) => output.length > 0)
    .join("\n\n");
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

export function renderComplianceGapProjectionDiagnostics(
  gaps: readonly ComplianceGapRenderInput[],
  options: ComplianceGapPullRequestProjectionOptions,
): string {
  if (options.relations === undefined) {
    return "relation metadata unavailable for PR compliance-gap projection";
  }

  return gaps
    .map((gap) => renderInternalComplianceDiagnostics(gap, options))
    .filter((output) => output.length > 0)
    .join("\n\n");
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

export function evaluateComplianceGapPullRequestProjection(
  gaps: readonly ComplianceGapRenderInput[],
  options: ComplianceGapPullRequestProjectionEvaluationOptions,
): ComplianceGapPullRequestProjectionEvaluationResult {
  const pullRequestOutput =
    options.pull_request_output ?? renderComplianceGapPullRequestProjection(gaps, options);
  const publishedGapIds = extractPublishedGapIds(pullRequestOutput);

  const unrelatedPublishedGap = gaps.find(
    (gap) => publishedGapIds.has(gap.id) && !isRelatedToChangedEntity(gap, options),
  );

  if (unrelatedPublishedGap !== undefined) {
    return {
      output_contract_check: "failed",
      rejected_gap_id: unrelatedPublishedGap.id,
      explanation: "PR output is limited to change-related compliance gaps",
    };
  }

  return {
    output_contract_check: "passed",
  };
}

function buildPullRequestRenderOptions(
  options: ComplianceGapPullRequestProjectionOptions,
  relations: readonly ComplianceGapRelation[],
): ComplianceGapPullRequestRenderOptions {
  return {
    catalog: options.catalog,
    relations,
    ...(options.changed_files === undefined ? {} : { changed_files: options.changed_files }),
    ...(options.changed_routes === undefined ? {} : { changed_routes: options.changed_routes }),
    ...(options.changed_dependencies === undefined
      ? {}
      : { changed_dependencies: options.changed_dependencies }),
  };
}

function findCataloguedControl(
  gap: ComplianceGapRenderInput,
  catalog: readonly CataloguedControlReference[],
): CataloguedControlReference | undefined {
  return catalog.find((candidate) => candidate.control_id === gap.control_id);
}

function renderProjectReportProjectionItem(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapRenderOptions,
): string {
  const output = renderComplianceGapProjectReportOutput(gap, options);

  if (output.length === 0) {
    return "";
  }

  return [`Gap id: ${gap.id}`, output].join("\n");
}

function renderPullRequestProjectionItem(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPullRequestRenderOptions,
): string {
  const output = renderComplianceGapPullRequestOutput(gap, options);

  if (output.length === 0) {
    return "";
  }

  return [`Gap id: ${gap.id}`, output].join("\n");
}

function isRelatedToChangedEntity(
  gap: ComplianceGapRenderInput,
  options: ComplianceGapPullRequestProjectionOptions,
): boolean {
  if (options.relations === undefined) {
    return false;
  }

  return options.relations.some(
    (relation) => relation.gap_id === gap.id && relationMatchesChange(relation, options),
  );
}

function relationMatchesChange(
  relation: ComplianceGapRelation,
  options: ComplianceGapPullRequestProjectionOptions,
): boolean {
  return (
    relationValueChanged(relation.file, options.changed_files) ||
    relationValueChanged(relation.route, options.changed_routes) ||
    relationValueChanged(relation.dependency, options.changed_dependencies)
  );
}

function relationValueChanged(
  value: string | undefined,
  changedValues: readonly string[] = [],
): boolean {
  return value !== undefined && changedValues.includes(value);
}

function extractPublishedGapIds(output: string): ReadonlySet<string> {
  const gapIds = new Set<string>();

  for (const line of output.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    const gapIdPrefix = "Gap id:";

    if (trimmedLine.startsWith(gapIdPrefix)) {
      const gapId = trimmedLine.slice(gapIdPrefix.length).trim();

      if (gapId.length > 0) {
        gapIds.add(gapId);
      }
    }
  }

  return gapIds;
}
