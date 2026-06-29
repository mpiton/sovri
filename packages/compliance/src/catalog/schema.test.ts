// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
});
