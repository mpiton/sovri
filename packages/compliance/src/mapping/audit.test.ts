// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema, type ComplianceMappingEntry } from "../index.js";

function buildCwe120EntryWithoutIsoReference(): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-120",
    title: "Buffer Copy without Checking Size of Input ('Classic Buffer Overflow')",
    mitre_url: "https://cwe.mitre.org/data/definitions/120.html",
    impacts: ["Memory corruption", "Availability loss"],
    references: [
      {
        framework: "CWE",
        identifier: "CWE-120",
        description: "Buffer Copy without Checking Size of Input ('Classic Buffer Overflow')",
        source_url: "https://cwe.mitre.org/data/definitions/120.html",
        applicability: "informational",
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        description:
          "Security of processing for classic buffer overflow exposure when personal data processing is affected.",
        source_url:
          "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679#d1e3316-1-1",
        applicability: "applicable_if",
        condition: "The affected system processes personal data as defined by GDPR Art. 4",
      },
    ],
  };
}

describe("Compliance mapping data audits", () => {
  it("rejects CWE-120 when the ISO 27001 A.8.28 reference is missing", () => {
    // Given a candidate batch 1 map contains "CWE-120"
    const candidateBatchOneMap = new Map<string, ComplianceMappingEntry>([
      ["CWE-120", buildCwe120EntryWithoutIsoReference()],
    ]);

    // And the "CWE-120" entry has no ISO27001-2022 reference
    const candidateEntry = candidateBatchOneMap.get("CWE-120");
    if (candidateEntry === undefined) {
      throw new TypeError("Expected candidate batch 1 map to contain CWE-120.");
    }

    // When the buffer overflow ISO audit runs
    const result = ComplianceMappingEntrySchema.safeParse(candidateEntry);

    // Then the audit fails
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the buffer overflow ISO audit to fail.");
    }

    const failureText = result.error.issues.map((issue) => issue.message).join("\n");

    // And the failure reports "CWE-120"
    expect(failureText).toContain("CWE-120");

    // And the failure reports missing identifier "A.8.28"
    expect(failureText).toContain("A.8.28");
  });
});
