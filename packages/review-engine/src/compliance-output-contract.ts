// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

export type ComplianceOutputTerm = "Finding" | "ComplianceGap" | "ControlResult";

export interface ComplianceOutputContractSchema {
  readonly name: ComplianceOutputTerm;
  readonly fields: readonly string[];
  readonly required?: readonly string[];
  readonly categories?: readonly string[];
}

export interface ComplianceOutputContractArtifactSet {
  readonly prompts: readonly string[];
  readonly schemas: readonly ComplianceOutputContractSchema[];
  readonly docs: readonly string[];
}

export interface ComplianceOutputContractReviewResult {
  readonly passed: boolean;
  readonly definitions: Readonly<Record<ComplianceOutputTerm, string>>;
  readonly failures: readonly string[];
  readonly schema: {
    readonly separate_contract_types: boolean;
    readonly compliance_gap_requires_cwe: boolean;
    readonly finding_has_compliance_category: boolean;
  };
}

const COMPLIANCE_OUTPUT_TERMS = ["Finding", "ComplianceGap", "ControlResult"] as const;
const COMPLIANCE_GAP_FINDING_CATEGORY_PATTERN =
  /(?:^|\s)(?:`|\*\*)?\bComplianceGap\b(?:`|\*\*)?\s+is\s+a\s+\bFinding\b\s+category\b(?:\s+emitted\s+by\s+PR\s+review\b)?/i;
const LLM_SOURCE_REFERENCE_REQUEST_PATTERN =
  /\b(?:write|provide|generate)\b.*\b(?:gdpr|dora|nis2|ai act)\b.*\bsource\s+urls?\b.*\bcompliance\s+gap\b/i;

export function reviewComplianceOutputContract(
  artifactSet: ComplianceOutputContractArtifactSet,
): ComplianceOutputContractReviewResult {
  const definitions = collectDefinitions(artifactSet.docs);
  const schema = reviewSchemaContract(artifactSet.schemas);
  const failures = [
    ...definitionFailures(definitions),
    ...findingCategoryFailures(artifactSet.docs),
    ...promptSourceReferenceFailures(artifactSet.prompts),
    ...schemaFailures(schema),
  ];

  return {
    passed: failures.length === 0,
    definitions,
    failures,
    schema,
  };
}

function collectDefinitions(
  docs: readonly string[],
): Readonly<Record<ComplianceOutputTerm, string>> {
  return {
    Finding: findDefinition(docs, "Finding"),
    ComplianceGap: findDefinition(docs, "ComplianceGap"),
    ControlResult: findDefinition(docs, "ControlResult"),
  };
}

function findDefinition(docs: readonly string[], term: ComplianceOutputTerm): string {
  for (const line of docs.join("\n").split(/\r?\n/)) {
    const definition = parseDefinitionLine(line, term);
    if (definition !== undefined) {
      return definition;
    }
  }

  return "";
}

function parseDefinitionLine(line: string, term: ComplianceOutputTerm): string | undefined {
  const marker = `${term} - `;
  const trimmedLine = line.trim();

  return trimmedLine.startsWith(marker) ? trimmedLine.slice(marker.length) : undefined;
}

function reviewSchemaContract(schemas: readonly ComplianceOutputContractSchema[]): {
  readonly separate_contract_types: boolean;
  readonly compliance_gap_requires_cwe: boolean;
  readonly finding_has_compliance_category: boolean;
} {
  const schemaByName = new Map(schemas.map((schema) => [schema.name, schema]));
  const findingSchema = schemaByName.get("Finding");
  const complianceGapSchema = schemaByName.get("ComplianceGap");

  return {
    separate_contract_types: COMPLIANCE_OUTPUT_TERMS.every((term) => schemaByName.has(term)),
    compliance_gap_requires_cwe: complianceGapSchema?.required?.includes("cwe") ?? false,
    finding_has_compliance_category: findingSchema?.categories?.includes("compliance") ?? false,
  };
}

function findingCategoryFailures(docs: readonly string[]): readonly string[] {
  return docs.some((doc) => COMPLIANCE_GAP_FINDING_CATEGORY_PATTERN.test(doc))
    ? ["ComplianceGap is project-level compliance output"]
    : [];
}

function promptSourceReferenceFailures(prompts: readonly string[]): readonly string[] {
  return prompts.some((prompt) => LLM_SOURCE_REFERENCE_REQUEST_PATTERN.test(prompt))
    ? ["framework references and source URLs must come from the catalog"]
    : [];
}

function definitionFailures(
  definitions: Readonly<Record<ComplianceOutputTerm, string>>,
): readonly string[] {
  return COMPLIANCE_OUTPUT_TERMS.filter((term) => definitions[term] === "").map(
    (term) => `${term} definition is required`,
  );
}

function schemaFailures(schema: ComplianceOutputContractReviewResult["schema"]): readonly string[] {
  const failures: string[] = [];

  if (!schema.separate_contract_types) {
    failures.push("Finding, ComplianceGap, and ControlResult must be separate contract types");
  }

  if (schema.compliance_gap_requires_cwe) {
    failures.push("ComplianceGap must not require a CWE");
  }

  if (schema.finding_has_compliance_category) {
    failures.push('Finding must not define a source-of-truth "compliance" category');
  }

  return failures;
}
