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

describe("User-controlled key authorization bypass maps to GDPR and ISO access control", () => {
  it("maps CWE-639 to a GDPR Art. 32 reference and an ISO 27001 A.5.15 reference", () => {
    expect(reference("CWE-639", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
    expect(reference("CWE-639", "ISO27001-2022")).toMatchObject({
      identifier: "A.5.15",
      applicability: "informational",
    });
  });

  it("fails the data audit when CWE-639 has no ISO 27001 reference", () => {
    const candidate = {
      cwe_id: "CWE-639",
      title: "Authorization Bypass Through User-Controlled Key",
      mitre_url: "https://cwe.mitre.org/data/definitions/639.html",
      impacts: ["Unauthorized data access"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-639",
          description: "Authorization Bypass Through User-Controlled Key",
          source_url: "https://cwe.mitre.org/data/definitions/639.html",
          applicability: "informational",
        },
        {
          framework: "GDPR",
          identifier: "Art. 32",
          description: "Security of processing for authorization bypass.",
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
      throw new TypeError("Expected the access-control regulatory audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-639");
    expect(failureText).toContain("ISO27001-2022");
  });

  it("fails the data audit when CWE-639 keeps ISO but omits GDPR", () => {
    const candidate = {
      cwe_id: "CWE-639",
      title: "Authorization Bypass Through User-Controlled Key",
      mitre_url: "https://cwe.mitre.org/data/definitions/639.html",
      impacts: ["Unauthorized data access"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-639",
          description: "Authorization Bypass Through User-Controlled Key",
          source_url: "https://cwe.mitre.org/data/definitions/639.html",
          applicability: "informational",
        },
        {
          framework: "ISO27001-2022",
          identifier: "A.5.15",
          description: "Access control policy guidance.",
          source_url: "https://www.iso.org/standard/82875.html",
          applicability: "informational",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the GDPR companion audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-639");
    expect(failureText).toContain("GDPR");
  });

  it("cites the official hosts on the CWE-639 GDPR and ISO references", () => {
    const gdpr = reference("CWE-639", "GDPR");
    const iso = reference("CWE-639", "ISO27001-2022");
    if (gdpr === undefined || iso === undefined) {
      throw new TypeError("Expected CWE-639 to carry GDPR and ISO references.");
    }

    expect(new URL(gdpr.source_url).host).toBe("eur-lex.europa.eu");
    expect(new URL(iso.source_url).host).toBe("www.iso.org");
  });
});
