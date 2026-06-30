// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  validateCatalogFixtureSuite,
  type CatalogFixtureSuiteValidationResult,
} from "./fixture-suite.js";
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

const missingRequiredFixtureSeedExamples = [
  {
    missingControl: "consent.tracker.prior-consent",
    presentControl: "access.logging.admin-actions",
    presentFixtureSeed: "cross-framework-control",
  },
  {
    missingControl: "access.logging.admin-actions",
    presentControl: "consent.tracker.prior-consent",
    presentFixtureSeed: "mat-114-consent-control",
  },
] satisfies readonly {
  readonly missingControl: string;
  readonly presentControl: string;
  readonly presentFixtureSeed: string;
}[];

const consentTrackerControl = "consent.tracker.prior-consent";
const consentTrackerDetectionRule = "consent.detect-trackers-without-consent-evidence";
const consentFixtureSeed = "mat-114-consent-control";

function catalogFixtureYaml(fixtureSeed: string, file: string): string {
  return catalogFixtureYamlByPath(`${fixtureSeed}/${file}`);
}

function catalogFixtureYamlByPath(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
}

function catalogFixtureFiles(): readonly string[] {
  return readdirSync(new URL("./fixtures/", import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith(".yaml")) {
        return [entry.name];
      }

      if (!entry.isDirectory()) {
        return [];
      }

      return readdirSync(new URL(`./fixtures/${entry.name}/`, import.meta.url), {
        withFileTypes: true,
      })
        .filter((fixtureFile) => fixtureFile.isFile() && fixtureFile.name.endsWith(".yaml"))
        .map((fixtureFile) => `${entry.name}/${fixtureFile.name}`);
    })
    .toSorted();
}

function catalogFixtureFileKind(fixtureFile: string): string {
  return fixtureFile.split("/").at(-1) ?? fixtureFile;
}

function relatedControlForFixtureFile(
  fixtureFile: string,
  fixtureFiles: readonly string[],
  frameworkFamily: string,
): unknown {
  if (!fixtureFile.endsWith("/rule.yaml")) {
    return undefined;
  }

  const controlFile = `${fixtureFile.slice(0, -"rule.yaml".length)}control.yaml`;
  if (!fixtureFiles.includes(controlFile)) {
    return undefined;
  }

  const controlResult = validateCatalogYaml({
    file: "control.yaml",
    frameworkFamily,
    yaml: catalogFixtureYamlByPath(controlFile),
  });

  return controlResult.success ? controlResult.data : undefined;
}

function formatValidationResult(result: ReturnType<typeof validateCatalogYaml>): string {
  if (result.success) {
    return "validation passed";
  }

  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

function formatFixtureSuiteValidationResult(result: CatalogFixtureSuiteValidationResult): string {
  if (result.success) {
    return "validation passed";
  }

  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
}

describe("compliance catalog fixture seeds", () => {
  it("validates every catalog YAML kind in the fixture suite", () => {
    const frameworkFamily = "mat-83-fixtures";
    const fixtureFiles = catalogFixtureFiles();

    // Given the fixtures include "framework.yaml"
    expect(
      fixtureFiles.some((fixtureFile) => catalogFixtureFileKind(fixtureFile) === "framework.yaml"),
    ).toBe(true);

    // And the fixtures include "control.yaml"
    expect(
      fixtureFiles.some((fixtureFile) => catalogFixtureFileKind(fixtureFile) === "control.yaml"),
    ).toBe(true);

    // And the fixtures include "rule.yaml"
    expect(
      fixtureFiles.some((fixtureFile) => catalogFixtureFileKind(fixtureFile) === "rule.yaml"),
    ).toBe(true);

    // And the fixtures include "mapping.yaml"
    expect(
      fixtureFiles.some((fixtureFile) => catalogFixtureFileKind(fixtureFile) === "mapping.yaml"),
    ).toBe(true);

    // When the fixture validation suite runs
    const validationLines = fixtureFiles.map((fixtureFile) => {
      const relatedControl = relatedControlForFixtureFile(
        fixtureFile,
        fixtureFiles,
        frameworkFamily,
      );
      const result = validateCatalogYaml({
        file: catalogFixtureFileKind(fixtureFile),
        frameworkFamily,
        ...(relatedControl === undefined ? {} : { relatedControl }),
        yaml: catalogFixtureYamlByPath(fixtureFile),
      });

      return `${fixtureFile}: ${formatValidationResult(result)}`;
    });

    // Then validation passes for every fixture file
    expect(validationLines.join("\n")).toBe(
      fixtureFiles.map((fixtureFile) => `${fixtureFile}: validation passed`).join("\n"),
    );
  });

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
      const fixtureSuiteResult = validateCatalogFixtureSuite({
        frameworkFamily,
        requiredControls: [example.control],
        requiredRules: [{ control: example.control, rule: example.rule }],
        seeds: [
          {
            controlYaml,
            name: example.fixtureSeed,
            ruleYaml,
          },
        ],
      });

      // Then validation passes for fixture seed "<fixture seed>"
      expect(
        [
          ...[controlResult, mappingResult, ruleResult].map(formatValidationResult),
          formatFixtureSuiteValidationResult(fixtureSuiteResult),
        ].join("\n"),
      ).toBe("validation passed\nvalidation passed\nvalidation passed\nvalidation passed");
    }
  });

  it("reports missing required fixture seed controls", () => {
    const frameworkFamily = "mat-83-fixtures";

    for (const example of missingRequiredFixtureSeedExamples) {
      // Given the fixtures include control "<present control>"
      const presentControlYaml = catalogFixtureYaml(example.presentFixtureSeed, "control.yaml");
      expect(presentControlYaml).toContain(`id: ${example.presentControl}`);

      // And the fixtures do not include control "<missing control>"
      expect(presentControlYaml).not.toContain(`id: ${example.missingControl}`);

      // When the fixture validation suite runs
      const result = validateCatalogFixtureSuite({
        frameworkFamily,
        requiredControls: [example.presentControl, example.missingControl],
        seeds: [
          {
            controlYaml: presentControlYaml,
            name: example.presentFixtureSeed,
          },
        ],
      });

      // Then validation fails
      expect(result.success).toBe(false);

      // And the validation error names "<missing control>"
      expect(formatFixtureSuiteValidationResult(result)).toContain(example.missingControl);
    }
  });

  it("reports validation errors in non-required fixture seeds", () => {
    const frameworkFamily = "mat-83-fixtures";
    const requiredControlYaml = catalogFixtureYaml(consentFixtureSeed, "control.yaml");
    const invalidNonRequiredControlYaml = catalogFixtureYaml(
      "cross-framework-control",
      "control.yaml",
    ).replace(/^remediation:.*\n/mu, "");

    // Given the required fixture seed is valid
    expect(requiredControlYaml).toContain(`id: ${consentTrackerControl}`);

    // And a non-required fixture seed is missing required schema data
    expect(invalidNonRequiredControlYaml).toContain("id: access.logging.admin-actions");
    expect(invalidNonRequiredControlYaml).not.toContain("remediation:");

    // When the fixture validation suite runs
    const result = validateCatalogFixtureSuite({
      frameworkFamily,
      requiredControls: [consentTrackerControl],
      seeds: [
        {
          controlYaml: requiredControlYaml,
          name: consentFixtureSeed,
        },
        {
          controlYaml: invalidNonRequiredControlYaml,
          name: "cross-framework-control",
        },
      ],
    });

    // Then validation fails
    expect(result.success).toBe(false);

    // And the validation error is keyed by the non-required fixture seed name
    expect(formatFixtureSuiteValidationResult(result)).toContain(
      "fixtures.cross-framework-control.control.yaml.remediation",
    );
  });

  it("reports a consent-control seed missing its tracker detection rule", () => {
    const frameworkFamily = "mat-83-fixtures";

    // Given the fixtures include control "consent.tracker.prior-consent"
    const controlYaml = catalogFixtureYaml(consentFixtureSeed, "control.yaml");
    expect(controlYaml).toContain(`id: ${consentTrackerControl}`);

    // And the tracker rule fixture exists but is not attached to the consent-control seed
    const misplacedRuleYaml = catalogFixtureYaml(consentFixtureSeed, "rule.yaml");
    const unrelatedControlYaml = catalogFixtureYaml("cross-framework-control", "control.yaml");
    expect(misplacedRuleYaml).toContain(`id: ${consentTrackerDetectionRule}`);
    expect(controlYaml).not.toContain(`id: ${consentTrackerDetectionRule}`);
    expect(unrelatedControlYaml).not.toContain(`id: ${consentTrackerControl}`);

    // When the fixture validation suite runs
    const result = validateCatalogFixtureSuite({
      frameworkFamily,
      requiredControls: [consentTrackerControl],
      requiredRules: [{ control: consentTrackerControl, rule: consentTrackerDetectionRule }],
      seeds: [
        {
          controlYaml,
          name: consentFixtureSeed,
        },
        {
          controlYaml: unrelatedControlYaml,
          name: "cross-framework-control",
          ruleYaml: misplacedRuleYaml,
        },
      ],
    });

    // Then validation fails
    expect(result.success).toBe(false);

    // And the validation error names "consent.detect-trackers-without-consent-evidence"
    expect(formatFixtureSuiteValidationResult(result)).toContain(
      `fixtures.${consentTrackerControl}.rules.${consentTrackerDetectionRule}`,
    );
  });

  it("rejects an attached rule fixture that violates its control input scope", () => {
    const frameworkFamily = "mat-83-fixtures";

    // Given the fixtures include a project-wide consent control
    const controlYaml = catalogFixtureYaml(consentFixtureSeed, "control.yaml");
    expect(controlYaml).toContain("applicability: project-wide");

    // And the attached tracker rule fixture is scoped to a file
    const fileScopedRuleYaml = catalogFixtureYaml(consentFixtureSeed, "rule.yaml").replace(
      "input_scope: project",
      "input_scope: file",
    );
    expect(fileScopedRuleYaml).toContain(`id: ${consentTrackerDetectionRule}`);
    expect(fileScopedRuleYaml).toContain("input_scope: file");

    // When the fixture validation suite runs
    const result = validateCatalogFixtureSuite({
      frameworkFamily,
      requiredControls: [consentTrackerControl],
      requiredRules: [{ control: consentTrackerControl, rule: consentTrackerDetectionRule }],
      seeds: [
        {
          controlYaml,
          name: consentFixtureSeed,
          ruleYaml: fileScopedRuleYaml,
        },
      ],
    });

    // Then validation fails
    expect(result.success).toBe(false);

    // And the malformed attached rule is not reported as present
    expect(formatFixtureSuiteValidationResult(result)).toContain(
      `fixtures.${consentTrackerControl}.rules.${consentTrackerDetectionRule}`,
    );
  });
});
