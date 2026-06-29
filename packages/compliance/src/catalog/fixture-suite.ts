// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { validateCatalogYaml } from "./schema.js";

export interface CatalogFixtureSeed {
  readonly controlYaml: string;
  readonly name: string;
}

export interface CatalogFixtureSuiteValidationInput {
  readonly frameworkFamily: string;
  readonly requiredControls: readonly string[];
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

export function validateCatalogFixtureSuite(
  input: CatalogFixtureSuiteValidationInput,
): CatalogFixtureSuiteValidationResult {
  const presentControlIds = new Set(
    input.seeds
      .map((seed) => controlIdFromFixtureSeed(seed, input.frameworkFamily))
      .filter((controlId): controlId is string => controlId !== undefined),
  );
  const missingControlIssues = input.requiredControls
    .filter((requiredControl) => !presentControlIds.has(requiredControl))
    .map((requiredControl) => ({
      message: `missing required fixture control "${requiredControl}"`,
      path: ["fixtures", requiredControl],
    }));

  if (missingControlIssues.length > 0) {
    return {
      error: {
        issues: missingControlIssues,
      },
      success: false,
    };
  }

  return {
    data: {
      controls: [...presentControlIds],
    },
    success: true,
  };
}
