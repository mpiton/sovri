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

interface CatalogSchemaModule {
  readonly CatalogSchemasByFile: Readonly<Record<string, CatalogSchema>>;
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
});
