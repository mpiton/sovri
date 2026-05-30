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

describe("Resource exhaustion CWEs map to DORA and NIS2", () => {
  it("maps CWE-770 to DORA Art. 9 and NIS2 conditional references", () => {
    expect(reference("CWE-770", "DORA")).toMatchObject({
      identifier: "Art. 9",
      applicability: "applicable_if",
      condition:
        "The affected system is part of the ICT infrastructure of a financial entity subject to DORA",
    });
    expect(reference("CWE-770", "NIS2")).toMatchObject({
      identifier: "Art. 21(2)(b)",
      applicability: "applicable_if",
    });
  });

  it("mentions DDoS protection in the CWE-770 NIS2 reference", () => {
    expect(reference("CWE-770", "NIS2")?.description).toContain("DDoS");
  });

  it("fails the data audit when CWE-770 has no DORA reference", () => {
    const candidate = {
      cwe_id: "CWE-770",
      title: "Allocation of Resources Without Limits or Throttling",
      mitre_url: "https://cwe.mitre.org/data/definitions/770.html",
      impacts: ["Denial of service"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-770",
          description: "Allocation of Resources Without Limits or Throttling",
          source_url: "https://cwe.mitre.org/data/definitions/770.html",
          applicability: "informational",
        },
      ],
    };

    const result = ComplianceMappingEntrySchema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new TypeError("Expected the resource-limits regulatory audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-770");
    expect(failureText).toContain("DORA");
  });

  it("fails the data audit when CWE-770 keeps DORA but omits NIS2", () => {
    const candidate = {
      cwe_id: "CWE-770",
      title: "Allocation of Resources Without Limits or Throttling",
      mitre_url: "https://cwe.mitre.org/data/definitions/770.html",
      impacts: ["Denial of service"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-770",
          description: "Allocation of Resources Without Limits or Throttling",
          source_url: "https://cwe.mitre.org/data/definitions/770.html",
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
      throw new TypeError("Expected the NIS2 companion audit to fail.");
    }
    const failureText = result.error.issues.map((issue) => issue.message).join("\n");
    expect(failureText).toContain("CWE-770");
    expect(failureText).toContain("NIS2");
  });

  it("cites EUR-Lex on the CWE-770 DORA and NIS2 references", () => {
    const dora = reference("CWE-770", "DORA");
    const nis2 = reference("CWE-770", "NIS2");
    if (dora === undefined || nis2 === undefined) {
      throw new TypeError("Expected CWE-770 to carry DORA and NIS2 references.");
    }

    expect(new URL(dora.source_url).host).toBe("eur-lex.europa.eu");
    expect(dora.source_url).toContain("32022R2554");
    expect(new URL(nis2.source_url).host).toBe("eur-lex.europa.eu");
    expect(nis2.source_url).toContain("32022L2555");
  });
});
