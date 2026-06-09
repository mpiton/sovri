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

describe("CWE-256 plaintext password storage mapping", () => {
  it("maps CWE-256 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-256", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-522 insufficiently protected credentials mapping", () => {
  it("maps CWE-522 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-522", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-359 personal information exposure mapping", () => {
  it("maps CWE-359 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-359", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-209 error message sensitive info mapping", () => {
  it("maps CWE-209 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-209", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("applicable_if conditions are non-empty across credential/info-exposure CWEs", () => {
  it("every applicable_if reference has a non-empty trimmed condition", () => {
    const cweIds = ["CWE-256", "CWE-522", "CWE-359", "CWE-209"];
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

describe("CWE-256 schema rejection", () => {
  it("rejects a CWE-256 entry missing the required GDPR reference", () => {
    const candidate = {
      cwe_id: "CWE-256",
      title: "Plaintext Storage of a Password",
      mitre_url: "https://cwe.mitre.org/data/definitions/256.html",
      impacts: ["x"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-256",
          description: "Plaintext Storage of a Password",
          source_url: "https://cwe.mitre.org/data/definitions/256.html",
          applicability: "informational",
        },
      ],
    };
    const result = ComplianceMappingEntrySchema.safeParse(candidate);
    expect(result.success).toBe(false);
    const failureText = result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
    expect(failureText).toContain("CWE-256");
    expect(failureText).toContain("GDPR");
  });
});
