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

const canonicalConditions = {
  gdpr: "The affected system processes personal data as defined by GDPR Art. 4",
  dora: "The affected system is part of the ICT infrastructure of a financial entity subject to DORA",
};

function readEntry(cweId: string): ComplianceMappingEntry {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry;
}

describe("Batch 2 applicable_if references carry an explicit condition", () => {
  it.each(batchTwoCweIds)("keeps every applicable_if reference on %s explicit", (cweId) => {
    const entry = readEntry(cweId);

    const applicableIfReferences = entry.references.filter(
      (reference) => reference.applicability === "applicable_if",
    );

    for (const reference of applicableIfReferences) {
      expect(reference.condition).toBeDefined();
      expect(reference.condition?.trim()).not.toBe("");
    }
  });

  it("rejects an applicable_if reference without an explicit condition", () => {
    // Given a candidate batch 2 reference with applicability applicable_if and no condition
    const candidate = {
      framework: "GDPR",
      identifier: "Art. 32",
      description: "Security of processing without a stated condition.",
      source_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679",
      applicability: "applicable_if",
    };

    // When it is parsed with ComplianceReferenceEntrySchema
    const result = ComplianceReferenceEntrySchema.safeParse(candidate);

    // Then parsing fails and the failure reports path "condition"
    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the conditionless applicable_if reference to be rejected.");
    }
    const paths = result.error.issues.flatMap((issue) => issue.path);
    expect(paths).toContain("condition");
  });

  it("reuses the canonical context wording across entries that share a condition", () => {
    // Given the batch 2 mapping entries for CWE-863 and CWE-284 are read from getCweMap
    const references = ["CWE-863", "CWE-284"].flatMap((cweId) => readEntry(cweId).references);

    const gdprConditions = references
      .filter((reference) => reference.framework === "GDPR" && reference.identifier === "Art. 32")
      .map((reference) => reference.condition);
    const doraConditions = references
      .filter((reference) => reference.framework === "DORA" && reference.identifier === "Art. 9")
      .map((reference) => reference.condition);

    expect(gdprConditions.length).toBeGreaterThan(0);
    for (const condition of gdprConditions) {
      expect(condition).toBe(canonicalConditions.gdpr);
    }
    expect(doraConditions.length).toBeGreaterThan(0);
    for (const condition of doraConditions) {
      expect(condition).toBe(canonicalConditions.dora);
    }
  });
});
