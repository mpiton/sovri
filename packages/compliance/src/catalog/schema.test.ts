// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CatalogSchemasByFile as PublicCatalogSchemasByFile,
  validateCatalogYaml as publicValidateCatalogYaml,
  type CatalogYamlValidationResult as PublicCatalogYamlValidationResult,
} from "../index.js";

interface ValidationIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

interface ValidationFailure {
  readonly error: {
    readonly issues: readonly ValidationIssue[];
  };
  readonly success: false;
}

interface ValidationSuccess {
  readonly data: unknown;
  readonly success: true;
}

interface CatalogSchema {
  safeParse(input: unknown): ValidationFailure | ValidationSuccess;
}

interface CatalogYamlValidationInput {
  readonly file: string;
  readonly frameworkFamily: string;
  readonly yaml: string;
}

type CatalogYamlValidator = (
  input: CatalogYamlValidationInput,
) => ValidationFailure | ValidationSuccess;

interface CatalogSchemaModule {
  readonly CatalogSchemasByFile: Readonly<Record<string, CatalogSchema>>;
  readonly validateCatalogYaml?: CatalogYamlValidator;
}

const catalogSchemaSourcePath = fileURLToPath(new URL("./schema.ts", import.meta.url));
const catalogModuleSpecifier = "./schema.js";

const catalogExamples = [
  {
    file: "framework.yaml",
    frameworkFamily: "gdpr-eprivacy",
    requiredFields: "id, name, version, jurisdiction, scope, source",
    data: {
      id: "gdpr-eprivacy",
      name: "GDPR and ePrivacy consent controls",
      version: "2016-2002",
      jurisdiction: "EU",
      scope: "Project websites that process personal data and use trackers",
      source: {
        url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
        description: "General Data Protection Regulation official text",
      },
    },
  },
  {
    file: "control.yaml",
    frameworkFamily: "gdpr-eprivacy",
    requiredFields: "id, title, description, severity, weight, remediation, applicability",
    data: {
      id: "consent.tracker.prior-consent",
      title: "Trackers require prior consent evidence",
      description: "Detect trackers that run before consent evidence is present.",
      severity: "major",
      weight: 8,
      remediation: "Block non-essential trackers until consent evidence is recorded.",
      applicability: "project-wide",
    },
  },
  {
    file: "rule.yaml",
    frameworkFamily: "gdpr-eprivacy",
    requiredFields:
      "id, rule_type, input_scope, expected_evidence, execution_policy, result_policy",
    data: {
      id: "consent.detect-trackers-without-consent-evidence",
      rule_type: "automatic",
      input_scope: "project",
      expected_evidence: "consent-evidence-record",
      execution_policy: "run-in-agent",
      result_policy: "fail-when-tracker-runs-without-consent-evidence",
    },
  },
  {
    file: "mapping.yaml",
    frameworkFamily: "gdpr-eprivacy",
    requiredFields: "control_id, framework_references",
    data: {
      control_id: "consent.tracker.prior-consent",
      framework_references: [
        {
          framework: "gdpr-eprivacy",
          version: "2016",
          reference: "gdpr:2016:article-6",
        },
      ],
    },
  },
] satisfies readonly {
  readonly data: unknown;
  readonly file: string;
  readonly frameworkFamily: string;
  readonly requiredFields: string;
}[];

const unknownFieldExamples = [
  {
    file: "framework.yaml",
    frameworkFamily: "gdpr-eprivacy",
    unknownField: "llm_prompt",
  },
  {
    file: "control.yaml",
    frameworkFamily: "gdpr-eprivacy",
    unknownField: "generated_summary",
  },
  {
    file: "rule.yaml",
    frameworkFamily: "gdpr-eprivacy",
    unknownField: "hardcoded_checker",
  },
  {
    file: "mapping.yaml",
    frameworkFamily: "gdpr-eprivacy",
    unknownField: "inferred_reference",
  },
] satisfies readonly {
  readonly file: string;
  readonly frameworkFamily: string;
  readonly unknownField: string;
}[];

const missingFieldExamples = [
  {
    file: "framework.yaml",
    frameworkFamily: "gdpr-eprivacy",
    missingField: "version",
  },
  {
    file: "control.yaml",
    frameworkFamily: "gdpr-eprivacy",
    missingField: "remediation",
  },
  {
    file: "rule.yaml",
    frameworkFamily: "gdpr-eprivacy",
    missingField: "expected_evidence",
  },
  {
    file: "mapping.yaml",
    frameworkFamily: "gdpr-eprivacy",
    missingField: "control_id",
  },
] satisfies readonly {
  readonly file: string;
  readonly frameworkFamily: string;
  readonly missingField: string;
}[];

const versionedFrameworkReferenceExamples = [
  {
    control: "consent.tracker.prior-consent",
    frameworkReferences: "gdpr:2016:article-6",
    referenceCount: 1,
  },
  {
    control: "access.logging.admin-actions",
    frameworkReferences: "iso27001:2022:a-8-15, nis2:2022:article-21-2-d",
    referenceCount: 2,
  },
  {
    control: "consent.tracker.prior-consent",
    frameworkReferences:
      "gdpr:2016:article-6, eprivacy:2002:article-5-3, eprivacy:2009:article-5-3",
    referenceCount: 3,
  },
] satisfies readonly {
  readonly control: string;
  readonly frameworkReferences: string;
  readonly referenceCount: number;
}[];

const supportedRuleExecutionTypeExamples = [
  {
    ruleId: "consent.detect-trackers",
    ruleType: "automatic",
  },
  {
    ruleId: "source.scan-cookie-banner",
    ruleType: "static-analysis",
  },
  {
    ruleId: "privacy.review-consent-copy",
    ruleType: "manual",
  },
  {
    ruleId: "evidence.record-cmp-configuration",
    ruleType: "evidence-only",
  },
] satisfies readonly {
  readonly ruleId: string;
  readonly ruleType: string;
}[];

const supportedRuleExecutionTypes = supportedRuleExecutionTypeExamples.map(
  (example) => example.ruleType,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCatalogSchema(value: unknown): value is CatalogSchema {
  return isRecord(value) && typeof value.safeParse === "function";
}

function isCatalogSchemaModule(value: unknown): value is CatalogSchemaModule {
  if (!isRecord(value) || !isRecord(value.CatalogSchemasByFile)) {
    return false;
  }

  return catalogExamples.every((example) =>
    isCatalogSchema(value.CatalogSchemasByFile[example.file]),
  );
}

function formatValidationFailure(result: ValidationFailure | ValidationSuccess): string {
  if (result.success) {
    return "validation passed";
  }

  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

function exampleDataWithUnknownField(file: string, unknownField: string): Record<string, unknown> {
  const example = catalogExamples.find((catalogExample) => catalogExample.file === file);

  if (example === undefined || !isRecord(example.data)) {
    throw new TypeError(`Expected catalog example data for ${file}.`);
  }

  return {
    ...example.data,
    [unknownField]: `unexpected value for ${unknownField}`,
  };
}

function exampleDataWithoutField(file: string, missingField: string): Record<string, unknown> {
  const example = catalogExamples.find((catalogExample) => catalogExample.file === file);

  if (example === undefined || !isRecord(example.data)) {
    throw new TypeError(`Expected catalog example data for ${file}.`);
  }

  const data = { ...example.data };
  Reflect.deleteProperty(data, missingField);
  return data;
}

function requireCatalogYamlValidator(moduleValue: CatalogSchemaModule): CatalogYamlValidator {
  expect(
    typeof moduleValue.validateCatalogYaml,
    "catalog schema module exports a YAML validator",
  ).toBe("function");

  if (typeof moduleValue.validateCatalogYaml !== "function") {
    throw new TypeError("Expected catalog schema module to export a YAML validator.");
  }

  return moduleValue.validateCatalogYaml;
}

function mappingYamlFor(control: string, frameworkReferences: readonly string[]): string {
  return [
    `control_id: ${control}`,
    "framework_references:",
    ...frameworkReferences.map((reference) => `  - ${reference}`),
  ].join("\n");
}

function ruleYamlFor(ruleId: string, ruleType: string): string {
  return [
    `id: ${ruleId}`,
    `rule_type: ${ruleType}`,
    "expected_evidence: compliance-rule-evidence",
  ].join("\n");
}

async function loadCatalogSchemaModule(): Promise<CatalogSchemaModule> {
  expect(
    existsSync(catalogSchemaSourcePath),
    "packages/compliance/src/catalog/schema.ts must provide catalog schemas",
  ).toBe(true);

  const moduleValue: unknown = await import(catalogModuleSpecifier);

  expect(isCatalogSchemaModule(moduleValue), "catalog schema module exports all YAML schemas").toBe(
    true,
  );
  if (!isCatalogSchemaModule(moduleValue)) {
    throw new TypeError("Expected catalog schema module exports all YAML schemas.");
  }

  return moduleValue;
}

describe("compliance catalog YAML schemas", () => {
  it("validates required catalog YAML kinds with concrete data", async () => {
    const { CatalogSchemasByFile } = await loadCatalogSchemaModule();

    for (const example of catalogExamples) {
      const schema = CatalogSchemasByFile[example.file];
      if (schema === undefined) {
        throw new TypeError(`Expected schema for ${example.file}.`);
      }

      // Given the compliance catalog contains "<file>" for framework family "gdpr-eprivacy"
      expect(example.file).toMatch(/^(framework|control|rule|mapping)\.yaml$/u);
      expect(example.frameworkFamily).toBe("gdpr-eprivacy");

      // And "<file>" contains the required fields "<required fields>"
      for (const field of example.requiredFields.split(", ")) {
        expect(JSON.stringify(example.data)).toContain(field);
      }

      // When the catalog schema validator runs
      const result = schema.safeParse(example.data);

      // Then validation passes for "<file>"
      expect(result.success, formatValidationFailure(result)).toBe(true);
    }
  });

  it("rejects unknown schema fields", async () => {
    const { CatalogSchemasByFile } = await loadCatalogSchemaModule();

    for (const example of unknownFieldExamples) {
      const schema = CatalogSchemasByFile[example.file];
      if (schema === undefined) {
        throw new TypeError(`Expected schema for ${example.file}.`);
      }

      // Given the compliance catalog contains "<file>" for framework family "gdpr-eprivacy"
      expect(example.file).toMatch(/^(framework|control|rule|mapping)\.yaml$/u);
      expect(example.frameworkFamily).toBe("gdpr-eprivacy");

      // And "<file>" includes the unknown top-level field "<unknown field>"
      const data = exampleDataWithUnknownField(example.file, example.unknownField);
      expect(Object.hasOwn(data, example.unknownField)).toBe(true);

      // When the catalog schema validator runs
      const result = schema.safeParse(data);

      // Then validation fails for "<file>"
      expect(result.success).toBe(false);

      // And the validation error names the unknown field "<unknown field>"
      if (result.success) {
        throw new TypeError(`Expected ${example.file} validation to fail.`);
      }
      expect(formatValidationFailure(result)).toContain(example.unknownField);
    }
  });

  it("rejects missing required schema fields", async () => {
    const { CatalogSchemasByFile } = await loadCatalogSchemaModule();

    for (const example of missingFieldExamples) {
      const schema = CatalogSchemasByFile[example.file];
      if (schema === undefined) {
        throw new TypeError(`Expected schema for ${example.file}.`);
      }

      // Given the compliance catalog contains "<file>" for framework family "gdpr-eprivacy"
      expect(example.file).toMatch(/^(framework|control|rule|mapping)\.yaml$/u);
      expect(example.frameworkFamily).toBe("gdpr-eprivacy");

      // And "<file>" is missing the required field "<missing field>"
      const data = exampleDataWithoutField(example.file, example.missingField);
      expect(Object.hasOwn(data, example.missingField)).toBe(false);

      // When the catalog schema validator runs
      const result = schema.safeParse(data);

      // Then validation fails for "<file>"
      expect(result.success).toBe(false);

      // And the validation error names the missing field "<missing field>"
      if (result.success) {
        throw new TypeError(`Expected ${example.file} validation to fail.`);
      }
      expect(formatValidationFailure(result)).toContain(example.missingField);
    }
  });

  it("validates one control mapped to one or more versioned framework references", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";

    for (const example of versionedFrameworkReferenceExamples) {
      const frameworkReferences = example.frameworkReferences.split(", ");
      const yaml = mappingYamlFor(example.control, frameworkReferences);

      // Given the catalog contains control "<control>"
      expect(example.control).toMatch(/^[a-z0-9.-]+$/u);
      expect(yaml).toContain(`control_id: ${example.control}`);

      // And "mapping.yaml" maps that control to framework references "<framework references>"
      expect(example.frameworkReferences).toBe(frameworkReferences.join(", "));
      for (const reference of frameworkReferences) {
        expect(yaml).toContain(`  - ${reference}`);
      }

      // When the catalog schema validator runs
      const result = validateCatalogYaml({ file, frameworkFamily, yaml });

      // Then validation passes for "mapping.yaml"
      expect(result.success, formatValidationFailure(result)).toBe(true);
      if (!result.success || !isRecord(result.data)) {
        throw new TypeError(`Expected ${file} validation to pass.`);
      }

      // And the control has <reference count> framework references
      expect(result.data.control_id).toBe(example.control);
      expect(result.data.framework_references).toHaveLength(example.referenceCount);
    }
  });

  it("rejects a mapping without framework references", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const yaml = [`control_id: ${control}`, "framework_references: []"].join("\n");

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to an empty framework reference list
    expect(yaml).toContain("framework_references: []");

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names "framework_references"
    expect(formatValidationFailure(result)).toContain("framework_references");
  });

  it("rejects a mapping to an unversioned framework reference", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const frameworkReference = "gdpr:article-6";
    const yaml = mappingYamlFor(control, [frameworkReference]);

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to framework reference "gdpr:article-6"
    expect(yaml).toContain(`  - ${frameworkReference}`);

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error reports that framework references must include a version
    expect(formatValidationFailure(result)).toContain("version");
  });

  it("rejects duplicate framework references for the same control", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const frameworkReference = "gdpr:2016:article-6";
    const yaml = mappingYamlFor(control, [frameworkReference, frameworkReference]);

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to framework reference "gdpr:2016:article-6"
    expect(yaml).toContain(`  - ${frameworkReference}`);

    // And "mapping.yaml" maps that control to framework reference "gdpr:2016:article-6" a second time
    expect(yaml.match(new RegExp(`  - ${frameworkReference}`, "gu"))).toHaveLength(2);

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names the duplicate reference "gdpr:2016:article-6"
    expect(formatValidationFailure(result)).toContain(frameworkReference);
  });

  it("rejects duplicate object-form framework references for the same control", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const frameworkReference = "gdpr:2016:article-6";
    const yaml = [
      `control_id: ${control}`,
      "framework_references:",
      "  - framework: gdpr-eprivacy",
      '    version: "2016"',
      `    reference: ${frameworkReference}`,
      "  - framework: gdpr-eprivacy",
      '    version: "2016"',
      `    reference: ${frameworkReference}`,
    ].join("\n");

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to the same object-form framework reference twice
    expect(yaml.match(new RegExp(`reference: ${frameworkReference}`, "gu"))).toHaveLength(2);

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names the duplicate reference "gdpr:2016:article-6"
    expect(formatValidationFailure(result)).toContain(frameworkReference);
  });

  it("rejects duplicate mixed-form framework references for the same control", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const frameworkReference = "gdpr:2016:article-6";
    const yaml = [
      `control_id: ${control}`,
      "framework_references:",
      `  - ${frameworkReference}`,
      "  - framework: gdpr",
      '    version: "2016"',
      "    reference: article-6",
    ].join("\n");

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to the same reference as a scalar and an object
    expect(yaml).toContain(`  - ${frameworkReference}`);
    expect(yaml).toContain("    reference: article-6");

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names the duplicate reference "gdpr:2016:article-6"
    expect(formatValidationFailure(result)).toContain(frameworkReference);
  });

  it("rejects duplicate mixed-form framework references with embedded scalar labels", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const control = "consent.tracker.prior-consent";
    const frameworkReference = "gdpr:2016:article-6";
    const yaml = [
      `control_id: ${control}`,
      "framework_references:",
      `  - ${frameworkReference}`,
      "  - framework: gdpr-eprivacy",
      '    version: "2016"',
      `    reference: ${frameworkReference}`,
    ].join("\n");

    // Given the catalog contains control "consent.tracker.prior-consent"
    expect(yaml).toContain(`control_id: ${control}`);

    // And "mapping.yaml" maps that control to the same scalar and embedded object label
    expect(yaml.match(new RegExp(frameworkReference, "gu"))).toHaveLength(2);

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "mapping.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names the duplicate reference "gdpr:2016:article-6"
    expect(formatValidationFailure(result)).toContain(frameworkReference);
  });

  it("validates supported rule execution types", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "rule.yaml";
    const frameworkFamily = "gdpr-eprivacy";

    for (const example of supportedRuleExecutionTypeExamples) {
      const yaml = ruleYamlFor(example.ruleId, example.ruleType);

      // Given the catalog contains rule "<rule id>"
      expect(yaml).toContain(`id: ${example.ruleId}`);

      // And "rule.yaml" declares rule_type "<rule type>"
      expect(yaml).toContain(`rule_type: ${example.ruleType}`);

      // When the catalog schema validator runs
      const result = validateCatalogYaml({ file, frameworkFamily, yaml });

      // Then validation passes for "rule.yaml"
      expect(result.success, formatValidationFailure(result)).toBe(true);
      if (!result.success || !isRecord(result.data)) {
        throw new TypeError(`Expected ${file} validation to pass.`);
      }

      // And the rule execution type is "<rule type>"
      expect(result.data.rule_type).toBe(example.ruleType);
    }
  });

  it("rejects unsupported rule execution types", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "rule.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const ruleId = "consent.detect-trackers";
    const ruleType = "llm-judgement";
    const yaml = ruleYamlFor(ruleId, ruleType);

    // Given the catalog contains rule "consent.detect-trackers"
    expect(yaml).toContain(`id: ${ruleId}`);

    // And "rule.yaml" declares rule_type "llm-judgement"
    expect(yaml).toContain(`rule_type: ${ruleType}`);

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "rule.yaml"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError(`Expected ${file} validation to fail.`);
    }

    // And the validation error names "rule_type"
    const formattedError = formatValidationFailure(result);
    expect(formattedError).toContain("rule_type");

    // And the validation error reports the supported values "automatic", "static-analysis", "manual", and "evidence-only"
    for (const supportedRuleExecutionType of supportedRuleExecutionTypes) {
      expect(formattedError).toContain(supportedRuleExecutionType);
    }
  });

  it("rejects empty YAML documents before catalog validation can pass", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "control.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = "";

    // Given the compliance catalog contains "control.yaml" for framework family "gdpr-eprivacy"
    expect(moduleValue.CatalogSchemasByFile[file]).toBeDefined();
    expect(frameworkFamily).toBe("gdpr-eprivacy");

    // And "control.yaml" is an empty YAML document
    expect(yaml).toBe("");

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "control.yaml"
    expect(result.success).toBe(false);

    // And the validation error reports that catalog YAML cannot be empty
    if (result.success) {
      throw new TypeError("Expected empty control.yaml validation to fail.");
    }
    expect(formatValidationFailure(result)).toContain("catalog YAML cannot be empty");
  });

  it("reports invalid YAML syntax before schema validation", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "framework.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = "id: [gdpr-eprivacy-consent";

    // Given the compliance catalog contains "framework.yaml" for framework family "gdpr-eprivacy"
    expect(moduleValue.CatalogSchemasByFile[file]).toBeDefined();
    expect(frameworkFamily).toBe("gdpr-eprivacy");

    // And "framework.yaml" contains the line "id: [gdpr-eprivacy-consent"
    expect(yaml).toContain("id: [gdpr-eprivacy-consent");

    // When the catalog schema validator runs
    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    // Then validation fails for "framework.yaml"
    expect(result.success).toBe(false);

    // And the validation error reports invalid YAML syntax
    if (result.success) {
      throw new TypeError("Expected invalid framework.yaml validation to fail.");
    }
    expect(formatValidationFailure(result)).toContain("invalid YAML syntax");
  });

  it("rejects parsed-empty YAML documents before catalog validation can pass", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "control.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = "---";

    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected parsed-empty control.yaml validation to fail.");
    }
    expect(formatValidationFailure(result)).toContain("catalog YAML cannot be empty");
  });

  it("validates parsed YAML content against the selected catalog schema", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "framework.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = "version: 2016-2002";

    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    expect(result.success, formatValidationFailure(result)).toBe(true);
    if (!result.success || !isRecord(result.data)) {
      throw new TypeError("Expected framework.yaml validation to return parsed data.");
    }
    expect(result.data.version).toBe("2016-2002");
  });

  it("reports schema validation errors from parsed YAML paths", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "mapping.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = [
      "control_id: consent.tracker.prior-consent",
      "framework_references:",
      "  - 42",
    ].join("\n");

    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected mapping.yaml schema validation to fail.");
    }
    expect(formatValidationFailure(result)).toContain("framework_references.0");
  });

  it("reports unsupported catalog YAML file names as validation failures", async () => {
    const moduleValue = await loadCatalogSchemaModule();
    const validateCatalogYaml = requireCatalogYamlValidator(moduleValue);
    const file = "unexpected.yaml";
    const frameworkFamily = "gdpr-eprivacy";
    const yaml = "version: 2016-2002";

    const result = validateCatalogYaml({ file, frameworkFamily, yaml });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected unsupported catalog YAML file validation to fail.");
    }
    expect(formatValidationFailure(result)).toContain("unsupported catalog YAML file");
    expect(formatValidationFailure(result)).toContain(file);
  });

  it("publishes catalog YAML validation from the package entry point", () => {
    expect(PublicCatalogSchemasByFile["framework.yaml"]).toBeDefined();
    expect(publicValidateCatalogYaml).toBeTypeOf("function");
    expectTypeOf<PublicCatalogYamlValidationResult>().not.toBeNever();

    const result = publicValidateCatalogYaml({
      file: "framework.yaml",
      frameworkFamily: "gdpr-eprivacy",
      yaml: "version: 2016-2002",
    });

    expect(result.success, formatValidationFailure(result)).toBe(true);
  });
});
