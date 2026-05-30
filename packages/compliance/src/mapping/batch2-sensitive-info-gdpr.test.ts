// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema } from "../index.js";

function gdprReference(cweId: string) {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry.references.find((reference) => reference.framework === "GDPR");
}

describe("Sensitive information exposure maps to GDPR", () => {
  it("maps CWE-200 to a GDPR conditional reference for personal-data exposure", () => {
    const reference = gdprReference("CWE-200");

    expect(reference?.identifier).toBe("Art. 32");
    expect(reference?.applicability).toBe("applicable_if");
    expect(reference?.condition).toBe("The exposed information includes personal data");
  });

  it("fails the data audit when CWE-200 has no GDPR reference", () => {
    // Given a candidate CWE-200 entry with no GDPR reference
    const candidate = {
      cwe_id: "CWE-200",
      title: "Exposure of Sensitive Information to an Unauthorized Actor",
      mitre_url: "https://cwe.mitre.org/data/definitions/200.html",
      impacts: ["Information disclosure"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-200",
          description: "Exposure of Sensitive Information to an Unauthorized Actor",
          source_url: "https://cwe.mitre.org/data/definitions/200.html",
          applicability: "informational",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the sensitive-information GDPR audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-200");
    expect(failureText).toContain("GDPR");
  });

  it("cites EUR-Lex on the CWE-200 GDPR reference", () => {
    const reference = gdprReference("CWE-200");
    if (reference === undefined) {
      throw new TypeError("Expected CWE-200 to carry a GDPR reference.");
    }

    expect(new URL(reference.source_url).host).toBe("eur-lex.europa.eu");
    expect(reference.source_url).toContain("32016R0679");
  });
});
