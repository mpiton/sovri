// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema, type ComplianceReferenceEntry } from "../index.js";

function reference(cweId: string, framework: string): ComplianceReferenceEntry | undefined {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry.references.find((candidate) => candidate.framework === framework);
}

describe("Authorization CWEs map to GDPR and DORA", () => {
  it.each(["CWE-863", "CWE-284"])(
    "maps %s to GDPR Art. 32 and DORA Art. 9 conditional references",
    (cweId) => {
      expect(reference(cweId, "GDPR")).toMatchObject({
        identifier: "Art. 32",
        applicability: "applicable_if",
      });
      expect(reference(cweId, "DORA")).toMatchObject({
        identifier: "Art. 9",
        applicability: "applicable_if",
      });
    },
  );

  it("fails the data audit when an authorization CWE has no DORA reference", () => {
    const candidate = {
      cwe_id: "CWE-863",
      title: "Incorrect Authorization",
      mitre_url: "https://cwe.mitre.org/data/definitions/863.html",
      impacts: ["Unauthorized access"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-863",
          description: "Incorrect Authorization",
          source_url: "https://cwe.mitre.org/data/definitions/863.html",
          applicability: "informational",
        },
        {
          framework: "GDPR",
          identifier: "Art. 32",
          description: "Security of processing for incorrect authorization.",
          source_url:
            "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679#d1e3316-1-1",
          applicability: "applicable_if",
          condition: "The affected system processes personal data as defined by GDPR Art. 4",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the authorization regulatory audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-863");
    expect(failureText).toContain("DORA");
  });

  it("fails the data audit when an authorization CWE keeps DORA but omits GDPR", () => {
    const candidate = {
      cwe_id: "CWE-863",
      title: "Incorrect Authorization",
      mitre_url: "https://cwe.mitre.org/data/definitions/863.html",
      impacts: ["Unauthorized access"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-863",
          description: "Incorrect Authorization",
          source_url: "https://cwe.mitre.org/data/definitions/863.html",
          applicability: "informational",
        },
        {
          framework: "DORA",
          identifier: "Art. 9",
          description: "ICT risk management protection and prevention controls.",
          source_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R2554",
          applicability: "applicable_if",
          condition:
            "The affected system is part of the ICT infrastructure of a financial entity subject to DORA",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the GDPR companion audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-863");
    expect(failureText).toContain("GDPR");
  });

  it("cites EUR-Lex on the authorization GDPR and DORA references", () => {
    for (const cweId of ["CWE-863", "CWE-284"]) {
      const gdpr = reference(cweId, "GDPR");
      const dora = reference(cweId, "DORA");
      if (gdpr === undefined || dora === undefined) {
        throw new TypeError(`Expected ${cweId} to carry GDPR and DORA references.`);
      }
      expect(new URL(gdpr.source_url).host).toBe("eur-lex.europa.eu");
      expect(new URL(dora.source_url).host).toBe("eur-lex.europa.eu");
      expect(dora.source_url).toContain("32022R2554");
    }
  });
});
