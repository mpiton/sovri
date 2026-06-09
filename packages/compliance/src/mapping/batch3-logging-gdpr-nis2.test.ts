// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getCweMap } from "./loader.js";

import { describe, expect, it } from "vitest";

import {
  ComplianceMappingEntrySchema,
  type ComplianceFramework,
  type ComplianceReferenceEntry,
} from "../index.js";

function reference(
  cweId: string,
  framework: ComplianceFramework,
): ComplianceReferenceEntry | undefined {
  const entry = getCweMap().get(cweId);
  if (entry === undefined) {
    throw new TypeError(`Expected ${cweId} to be mapped.`);
  }
  return entry.references.find((candidate) => candidate.framework === framework);
}

describe("CWE-532 logging mapping", () => {
  it("maps CWE-532 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-532", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });

  it("maps CWE-532 to NIS2 as applicable_if", () => {
    expect(reference("CWE-532", "NIS2")?.applicability).toBe("applicable_if");
  });

  it("keeps every applicable_if reference on CWE-532 conditioned", () => {
    const entry = getCweMap().get("CWE-532");
    const applicableIf = entry?.references.filter((r) => r.applicability === "applicable_if") ?? [];
    expect(applicableIf.length).toBeGreaterThan(0);
    for (const r of applicableIf) {
      expect(r.condition?.trim()).not.toBe("");
    }
  });

  it("rejects a CWE-532 entry missing the required GDPR reference", () => {
    const candidate = {
      cwe_id: "CWE-532",
      title: "Insertion of Sensitive Information into Log File",
      mitre_url: "https://cwe.mitre.org/data/definitions/532.html",
      impacts: ["x"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-532",
          description: "Insertion of Sensitive Information into Log File",
          source_url: "https://cwe.mitre.org/data/definitions/532.html",
          applicability: "informational",
        },
      ],
    };
    const result = ComplianceMappingEntrySchema.safeParse(candidate);
    expect(result.success).toBe(false);
    const failureText = result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
    expect(failureText).toContain("CWE-532");
    expect(failureText).toContain("GDPR");
  });
});
