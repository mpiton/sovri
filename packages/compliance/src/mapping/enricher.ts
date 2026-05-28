// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding } from "@sovri/core";

import { getCweMap } from "./loader.js";

/**
 * Populate a finding's compliance_references from the static CWE map.
 *
 * Pure and deterministic: the result depends only on finding.cwe and the
 * in-memory map. references are recomputed on every call (overwrite), so a
 * finding whose cwe no longer resolves is cleared to an empty array.
 */
export function enrichFindingCompliance(finding: Finding): Finding {
  const { cwe } = finding;
  if (cwe === undefined) {
    return { ...finding, compliance_references: [] };
  }

  const entry = getCweMap().get(cwe);
  if (entry === undefined) {
    return { ...finding, compliance_references: [] };
  }

  return { ...finding, compliance_references: [...entry.references] };
}
