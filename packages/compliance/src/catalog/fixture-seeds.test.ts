// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateCatalogYaml } from "./schema.js";

const catalogFixtureSeedExamples = [
  {
    control: "access.logging.admin-actions",
    fixtureSeed: "cross-framework-control",
    frameworkReferences: ["iso27001:2022:a-8-15", "nis2:2022:article-21-2-d"],
    rule: "access.logging.admin-actions-present",
  },
  {
    control: "consent.tracker.prior-consent",
    fixtureSeed: "mat-114-consent-control",
    frameworkReferences: ["gdpr:2016:article-6", "eprivacy:2002:article-5-3"],
    rule: "consent.detect-trackers-without-consent-evidence",
  },
] satisfies readonly {
  readonly control: string;
  readonly fixtureSeed: string;
  readonly frameworkReferences: readonly string[];
  readonly rule: string;
}[];

function catalogFixtureYaml(fixtureSeed: string, file: string): string {
  return readFileSync(new URL(`./fixtures/${fixtureSeed}/${file}`, import.meta.url), "utf8");
}

function formatValidationResult(result: ReturnType<typeof validateCatalogYaml>): string {
  if (result.success) {
    return "validation passed";
  }

  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

describe("compliance catalog fixture seeds", () => {
  it("validates required catalog fixture seeds", () => {
    const frameworkFamily = "mat-83-fixtures";

    for (const example of catalogFixtureSeedExamples) {
      const controlYaml = catalogFixtureYaml(example.fixtureSeed, "control.yaml");
      const mappingYaml = catalogFixtureYaml(example.fixtureSeed, "mapping.yaml");
      const ruleYaml = catalogFixtureYaml(example.fixtureSeed, "rule.yaml");

      // Given the fixtures include control "<control>"
      expect(controlYaml).toContain(`id: ${example.control}`);

      // And the fixture maps it to framework references "<framework references>"
      expect(mappingYaml).toContain(`control_id: ${example.control}`);
      for (const frameworkReference of example.frameworkReferences) {
        expect(mappingYaml).toContain(frameworkReference);
      }

      // And the fixture includes rule "<rule>"
      expect(ruleYaml).toContain(`id: ${example.rule}`);

      // When the fixture validation suite runs
      const controlResult = validateCatalogYaml({
        file: "control.yaml",
        frameworkFamily,
        yaml: controlYaml,
      });
      const mappingResult = validateCatalogYaml({
        file: "mapping.yaml",
        frameworkFamily,
        yaml: mappingYaml,
      });
      const ruleResult = validateCatalogYaml({
        file: "rule.yaml",
        frameworkFamily,
        relatedControl: controlResult.success ? controlResult.data : undefined,
        yaml: ruleYaml,
      });

      // Then validation passes for fixture seed "<fixture seed>"
      expect(
        [controlResult, mappingResult, ruleResult].map(formatValidationResult).join("\n"),
      ).toBe("validation passed\nvalidation passed\nvalidation passed");
    }
  });
});
