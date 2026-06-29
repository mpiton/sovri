// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { validateCatalogYaml } from "./schema.js";

export interface CatalogFixtureSeed {
  readonly controlYaml: string;
  readonly name: string;
  readonly ruleYaml?: string;
}

export interface CatalogFixtureRequiredRule {
  readonly control: string;
  readonly rule: string;
}

export interface CatalogFixtureSuiteValidationInput {
  readonly frameworkFamily: string;
  readonly requiredControls: readonly string[];
  readonly requiredRules?: readonly CatalogFixtureRequiredRule[];
  readonly seeds: readonly CatalogFixtureSeed[];
}

export interface CatalogFixtureSuiteValidationIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

export type CatalogFixtureSuiteValidationResult =
  | {
      readonly data: unknown;
      readonly success: true;
    }
  | {
      readonly error: {
        readonly issues: readonly CatalogFixtureSuiteValidationIssue[];
      };
      readonly success: false;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function controlIdFromFixtureSeed(
  seed: CatalogFixtureSeed,
  frameworkFamily: string,
): string | undefined {
  const result = validateCatalogYaml({
    file: "control.yaml",
    frameworkFamily,
    yaml: seed.controlYaml,
  });

  if (!result.success || !isRecord(result.data) || typeof result.data.id !== "string") {
    return undefined;
  }

  return result.data.id;
}

function ruleIdFromFixtureSeed(
  seed: CatalogFixtureSeed,
  frameworkFamily: string,
): string | undefined {
  if (seed.ruleYaml === undefined) {
    return undefined;
  }

  const result = validateCatalogYaml({
    file: "rule.yaml",
    frameworkFamily,
    yaml: seed.ruleYaml,
  });

  if (!result.success || !isRecord(result.data) || typeof result.data.id !== "string") {
    return undefined;
  }

  return result.data.id;
}

export function validateCatalogFixtureSuite(
  input: CatalogFixtureSuiteValidationInput,
): CatalogFixtureSuiteValidationResult {
  const parsedSeeds = input.seeds.map((seed) => ({
    controlId: controlIdFromFixtureSeed(seed, input.frameworkFamily),
    name: seed.name,
    ruleId: ruleIdFromFixtureSeed(seed, input.frameworkFamily),
  }));
  const presentControlIds = new Set(
    parsedSeeds
      .map((seed) => seed.controlId)
      .filter((controlId): controlId is string => controlId !== undefined),
  );
  const missingControlIssues = input.requiredControls
    .filter((requiredControl) => !presentControlIds.has(requiredControl))
    .map((requiredControl) => ({
      message: `missing required fixture control "${requiredControl}"`,
      path: ["fixtures", requiredControl],
    }));
  const presentRuleIds = new Set(
    parsedSeeds
      .map((seed) => seed.ruleId)
      .filter((ruleId): ruleId is string => ruleId !== undefined),
  );
  const missingRuleIssues = (input.requiredRules ?? [])
    .filter(
      (requiredRule) =>
        !parsedSeeds.some(
          (seed) => seed.controlId === requiredRule.control && seed.ruleId === requiredRule.rule,
        ),
    )
    .map((requiredRule) => ({
      message: `missing required fixture rule "${requiredRule.rule}" for control "${requiredRule.control}"`,
      path: ["fixtures", requiredRule.control, "rules", requiredRule.rule],
    }));
  const issues = [...missingControlIssues, ...missingRuleIssues];

  if (issues.length > 0) {
    return {
      error: {
        issues,
      },
      success: false,
    };
  }

  return {
    data: {
      controls: [...presentControlIds],
      rules: [...presentRuleIds],
    },
    success: true,
  };
}
