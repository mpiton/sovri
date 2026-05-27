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
 * Thrown when `.sovri.yml` exists on disk as a symbolic link.
 *
 * A malicious repository can ship `.sovri.yml` as a symlink to any file the
 * bot process can read (e.g. `/etc/passwd`, `~/.ssh/id_rsa`, the GitHub App
 * private key). Following the link would read the target into the YAML
 * parser and, on parse failure, embed a fragment of the target's bytes into
 * a `YAMLException` cause chain that a PR-comment renderer could surface.
 *
 * This error is intentionally minimal: it carries `filePath` only, with NO
 * `cause` field. The whole class of disclosure leaks via `Error.cause`
 * serialization is eliminated at the type level.
 *
 * @see {@link https://github.com/mpiton/sovri/issues/1744}
 */
export class SovriConfigSymlinkError extends Error {
  override readonly name = "SovriConfigSymlinkError";
  readonly filePath: string;

  constructor(filePath: string) {
    super(`Refusing to read ${filePath}: symlinks are not permitted for .sovri.yml`);
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
