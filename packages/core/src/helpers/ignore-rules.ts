// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { posix } from "node:path";

import type { Finding } from "../types/Finding.js";

// `path.posix.matchesGlob` was marked stable in Node 24.8.0 (the workspace
// `engines.node` floor). POSIX variant gives platform-independent glob
// semantics for repository-relative paths (the only shape findings carry in
// `file`).
function matchesAny(file: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (posix.matchesGlob(file, pattern)) return true;
  }
  return false;
}

/**
 * Filters out findings whose `file` matches any of the supplied glob patterns.
 *
 * - OR semantics: a finding is dropped if at least one pattern matches.
 * - Empty `ignores` returns a fresh copy of the input list (no-op filter).
 * - The input array and individual findings are never mutated.
 *
 * Pre-conditions on `finding.file`:
 * - Treated as a POSIX-style, repository-relative path. Callers must normalize
 *   upstream — absolute paths and `../` traversal segments are matched
 *   literally and may not be captured by patterns like `**` (which does not
 *   cross leading `../` boundaries under POSIX glob semantics).
 * - The path itself is treated literally, never glob-expanded. A file whose
 *   name contains glob metacharacters (`[`, `?`, `*`) is still compared as a
 *   plain string — only the second argument is interpreted as a glob.
 * - Malformed patterns (e.g. unterminated `[`) silently produce no match
 *   rather than throwing, matching Node's `path.posix.matchesGlob` behaviour.
 */
export function applyIgnoreRules(
  findings: readonly Finding[],
  ignores: readonly string[],
): readonly Finding[] {
  if (ignores.length === 0) return [...findings];
  return findings.filter((finding) => !matchesAny(finding.file, ignores));
}
