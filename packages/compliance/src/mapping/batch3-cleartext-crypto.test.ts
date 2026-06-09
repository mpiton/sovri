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

describe("CWE-312 cleartext storage mapping", () => {
  it("maps CWE-312 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-312", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-319 cleartext transmission mapping", () => {
  it("maps CWE-319 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-319", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-313 cleartext storage on disk mapping", () => {
  it("maps CWE-313 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-313", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-328 weak hash mapping", () => {
  it("maps CWE-328 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-328", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("applicable_if conditions are non-empty across cleartext/crypto CWEs", () => {
  it("every applicable_if reference has a non-empty trimmed condition", () => {
    const cweIds = ["CWE-312", "CWE-319", "CWE-313", "CWE-328"];
    for (const cweId of cweIds) {
      const entry = getCweMap().get(cweId);
      const applicableIf =
        entry?.references.filter((r) => r.applicability === "applicable_if") ?? [];
      expect(applicableIf.length).toBeGreaterThan(0);
      for (const r of applicableIf) {
        expect(r.condition?.trim()).not.toBe("");
      }
    }
  });
});

describe("CWE-312 schema rejection", () => {
  it("rejects a CWE-312 entry missing the required GDPR reference", () => {
    const candidate = {
      cwe_id: "CWE-312",
      title: "Cleartext Storage of Sensitive Information",
      mitre_url: "https://cwe.mitre.org/data/definitions/312.html",
      impacts: ["x"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-312",
          description: "Cleartext Storage of Sensitive Information",
          source_url: "https://cwe.mitre.org/data/definitions/312.html",
          applicability: "informational",
        },
      ],
    };
    const result = ComplianceMappingEntrySchema.safeParse(candidate);
    expect(result.success).toBe(false);
    const failureText = result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
    expect(failureText).toContain("CWE-312");
    expect(failureText).toContain("GDPR");
  });
});
