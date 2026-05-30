// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import { ComplianceMappingEntrySchema } from "../index.js";

function aiActReference(cweId: string) {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry.references.find((reference) => reference.framework === "AI-ACT");
}

describe("Server-side request forgery maps to the AI Act", () => {
  it("maps CWE-918 to an AI-ACT Art. 12 conditional reference for high-risk AI systems", () => {
    const reference = aiActReference("CWE-918");

    expect(reference?.identifier).toBe("Art. 12");
    expect(reference?.applicability).toBe("applicable_if");
    expect(reference?.condition).toBe(
      "The system is a high-risk AI system subject to AI Act Art. 6",
    );
  });

  it("fails the data audit when CWE-918 has no AI-ACT reference", () => {
    const candidate = {
      cwe_id: "CWE-918",
      title: "Server-Side Request Forgery (SSRF)",
      mitre_url: "https://cwe.mitre.org/data/definitions/918.html",
      impacts: ["Internal service access"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-918",
          description: "Server-Side Request Forgery (SSRF)",
          source_url: "https://cwe.mitre.org/data/definitions/918.html",
          applicability: "informational",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the AI Act regulatory audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-918");
    expect(failureText).toContain("AI-ACT");
  });

  it("cites EUR-Lex on the CWE-918 AI-ACT reference", () => {
    const reference = aiActReference("CWE-918");
    if (reference === undefined) {
      throw new TypeError("Expected CWE-918 to carry an AI-ACT reference.");
    }

    expect(new URL(reference.source_url).host).toBe("eur-lex.europa.eu");
    expect(reference.source_url).toContain("32024R1689");
  });
});
