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

const COMPLIANCE_OUTPUT_TERMS: readonly ComplianceOutputTerm[] = [
  "Finding",
  "ComplianceGap",
  "ControlResult",
];
const REQUIRED_SCHEMA_FIELDS: Readonly<Record<ComplianceOutputTerm, string>> = {
  Finding: "cwe",
  ComplianceGap: "control_id",
  ControlResult: "status",
};
const FINDING_CATEGORY_MISUSE_PATTERN =
  /(?:^|\s)(?:`|\*\*)?\b(ComplianceGap|ControlResult)\b(?:`|\*\*)?\s+is\s+a\s+\bFinding\b\s+category\b(?:\s+emitted\s+by\s+PR\s+review\b)?/i;
const FINDING_CATEGORY_MISUSE_PROHIBITION_PATTERN =
  /\b(?:do\s+not|don't|never)\b[^.:\n]*(?:`|\*\*)?\b(?:ComplianceGap|ControlResult)\b(?:`|\*\*)?\s+is\s+a\s+\bFinding\b\s+category\b/i;
const SOURCE_REFERENCE_REQUEST_VERB_PATTERN = /\b(?:write|provide|generate|author)\b/i;
const SOURCE_REFERENCE_PROHIBITION_PATTERN =
  /\b(?:do\s+not|don't|never)\s+(?:(?:ask|allow|tell)\s+(?:the\s+)?LLM\s+to\s+)?(?:write|provide|generate|author)\b/i;
const SOURCE_URL_PATTERN = /\bsource\s+urls?\b/i;
const COMPLIANCE_GAP_REFERENCE_PATTERN = /\bcompliance\s*gaps?\b|\bComplianceGap\b/i;

export function reviewComplianceOutputContract(
  artifactSet: ComplianceOutputContractArtifactSet,
): ComplianceOutputContractReviewResult {
  const definitions = collectDefinitions(artifactSet.docs);
  const schema = reviewSchemaContract(artifactSet.schemas);
  const failures = [
    ...definitionFailures(definitions),
    ...findingCategoryFailures(artifactSet.docs),
    ...promptSourceReferenceFailures(artifactSet.prompts),
    ...schemaFieldFailures(artifactSet.schemas),
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
  for (const doc of docs) {
    for (const line of doc.split(/\r?\n/)) {
      const definition = parseDefinitionLine(line, term);
      if (definition !== undefined) {
        return definition;
      }
    }
  }

  return "";
}

function parseDefinitionLine(line: string, term: ComplianceOutputTerm): string | undefined {
  const normalized = line.trim().replace(/^[-*+]\s+/u, "");

  for (const marker of [`${term} - `, `**${term}** - `, `\`${term}\` - `]) {
    if (normalized.startsWith(marker)) {
      return normalized.slice(marker.length).trim();
    }
  }

  return undefined;
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
    compliance_gap_requires_cwe: schemaDeclaresCwe(complianceGapSchema),
    finding_has_compliance_category: findingSchema?.categories?.includes("compliance") ?? false,
  };
}

function schemaDeclaresCwe(schema: ComplianceOutputContractSchema | undefined): boolean {
  if (schema === undefined) {
    return false;
  }

  return schema.fields.includes("cwe") || (schema.required?.includes("cwe") ?? false);
}

function findingCategoryFailures(docs: readonly string[]): readonly string[] {
  const failures: string[] = [];

  for (const doc of docs) {
    for (const line of doc.split(/\r?\n/)) {
      if (FINDING_CATEGORY_MISUSE_PROHIBITION_PATTERN.test(line)) {
        continue;
      }

      const match = line.match(FINDING_CATEGORY_MISUSE_PATTERN);
      if (match?.[1] === "ComplianceGap") {
        failures.push("ComplianceGap is project-level compliance output");
      }
      if (match?.[1] === "ControlResult") {
        failures.push("ControlResult is a control evaluation result");
      }
    }
  }

  return failures;
}

function promptSourceReferenceFailures(prompts: readonly string[]): readonly string[] {
  return prompts.some((prompt) => promptRequestsSourceReference(prompt))
    ? ["framework references and source URLs must come from the catalog"]
    : [];
}

function promptRequestsSourceReference(prompt: string): boolean {
  return prompt
    .split(/[.!?;\n]+/)
    .some(
      (segment) =>
        !SOURCE_REFERENCE_PROHIBITION_PATTERN.test(segment) &&
        SOURCE_REFERENCE_REQUEST_VERB_PATTERN.test(segment) &&
        SOURCE_URL_PATTERN.test(segment) &&
        COMPLIANCE_GAP_REFERENCE_PATTERN.test(segment),
    );
}

function definitionFailures(
  definitions: Readonly<Record<ComplianceOutputTerm, string>>,
): readonly string[] {
  return COMPLIANCE_OUTPUT_TERMS.filter((term) => definitions[term] === "").map(
    (term) => `${term} definition is required`,
  );
}

function schemaFieldFailures(
  schemas: readonly ComplianceOutputContractSchema[],
): readonly string[] {
  const schemaByName = new Map(schemas.map((schema) => [schema.name, schema]));
  const failures: string[] = [];

  for (const term of COMPLIANCE_OUTPUT_TERMS) {
    const requiredField = REQUIRED_SCHEMA_FIELDS[term];
    const schema = schemaByName.get(term);
    if (schema !== undefined && !schema.fields.includes(requiredField)) {
      failures.push(`${term} schema must define field "${requiredField}"`);
    }
  }

  return failures;
}

function schemaFailures(schema: ComplianceOutputContractReviewResult["schema"]): readonly string[] {
  const failures: string[] = [];

  if (!schema.separate_contract_types) {
    failures.push("Finding, ComplianceGap, and ControlResult must be separate contract types");
  }

  if (schema.compliance_gap_requires_cwe) {
    failures.push("ComplianceGap must not define a CWE field");
  }

  if (schema.finding_has_compliance_category) {
    failures.push('Finding must not define a source-of-truth "compliance" category');
  }

  return failures;
}
