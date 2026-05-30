// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { ComplianceReferenceEntrySchema, type ComplianceMappingEntry } from "../index.js";

const batchTwoCweIds = [
  "CWE-20",
  "CWE-77",
  "CWE-121",
  "CWE-122",
  "CWE-200",
  "CWE-284",
  "CWE-306",
  "CWE-502",
  "CWE-639",
  "CWE-770",
  "CWE-798",
  "CWE-863",
  "CWE-918",
];

const automaticApplicabilities = new Set(["applicable_if", "informational"]);

function readEntry(cweId: string): ComplianceMappingEntry {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry;
}

describe("Batch 2 references stay within automatic applicability states", () => {
  it.each(batchTwoCweIds)("uses only automatic applicability states on %s", (cweId) => {
    const entry = readEntry(cweId);

    for (const reference of entry.references) {
      expect(automaticApplicabilities.has(reference.applicability)).toBe(true);
    }
  });

  it("rejects a reference whose applicability is confirmed", () => {
    // Given a candidate batch 2 reference whose applicability is "confirmed"
    const candidate = {
      framework: "GDPR",
      identifier: "Art. 32",
      description: "A reference that claims a confirmed regulatory match.",
      source_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679",
      applicability: "confirmed",
    };

    // When it is parsed with ComplianceReferenceEntrySchema
    const result = ComplianceReferenceEntrySchema.safeParse(candidate);

    // Then parsing fails and the failure reports path "applicability"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected confirmed applicability to be rejected.");
    }
    const paths = result.error.issues.flatMap((issue) => issue.path);
    expect(paths).toContain("applicability");
  });

  it("keeps enriched CWE-798 inside the same applicability domain", () => {
    // Given the mapping entry for CWE-798 is read from getCweMap
    const entry = readEntry("CWE-798");

    // Then every applicability is automatic and none is confirmed
    for (const reference of entry.references) {
      expect(automaticApplicabilities.has(reference.applicability)).toBe(true);
      expect(reference.applicability).not.toBe("confirmed");
    }
  });
});
