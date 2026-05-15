// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

/**
 * Thrown when `.sovri.yml` exists but cannot be parsed as YAML.
 *
 * The original `YAMLException` (or other parser error) is preserved in
 * `cause` so a PR-comment renderer can surface line/column diagnostics
 * without re-parsing.
 */
export class SovriConfigParseError extends Error {
  override readonly name = "SovriConfigParseError";
  readonly filePath: string;

  constructor(filePath: string, cause: unknown) {
    super(`Failed to parse YAML at ${filePath}`, { cause });
    this.filePath = filePath;
  }
}

/**
 * Thrown when `.sovri.yml` parses as YAML but violates `SovriConfigSchema`.
 *
 * The full `ZodError` is preserved in `cause`; `issues` is exposed as a
 * convenience for callers that render structured feedback (PR comments,
 * dashboards) without unwrapping the cause chain.
 */
export class SovriConfigValidationError extends Error {
  override readonly name = "SovriConfigValidationError";
  readonly filePath: string;
  readonly issues: ReadonlyArray<z.core.$ZodIssue>;

  constructor(filePath: string, cause: z.ZodError) {
    super(`Config at ${filePath} failed schema validation`, { cause });
    this.filePath = filePath;
    this.issues = cause.issues;
  }
}
