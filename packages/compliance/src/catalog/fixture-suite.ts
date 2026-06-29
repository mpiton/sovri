// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

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

export function validateCatalogFixtureSuite(
  _input: CatalogFixtureSuiteValidationInput,
): CatalogFixtureSuiteValidationResult {
  return {
    data: {},
    success: true,
  };
}
