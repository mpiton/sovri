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

describe("CWE-307 improper restriction of excessive authentication attempts mapping", () => {
  it("maps CWE-307 to NIS2 Art. 21(2)(i) as applicable_if", () => {
    expect(reference("CWE-307", "NIS2")).toMatchObject({
      identifier: "Art. 21(2)(i)",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-521 weak password requirements mapping", () => {
  it("maps CWE-521 to NIS2 Art. 21(2)(i) as applicable_if", () => {
    expect(reference("CWE-521", "NIS2")).toMatchObject({
      identifier: "Art. 21(2)(i)",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-327 use of a broken or risky cryptographic algorithm mapping", () => {
  it("maps CWE-327 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-327", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("CWE-916 use of password hash with insufficient computational effort mapping", () => {
  it("maps CWE-916 to GDPR Art. 32 as applicable_if", () => {
    expect(reference("CWE-916", "GDPR")).toMatchObject({
      identifier: "Art. 32",
      applicability: "applicable_if",
    });
  });
});

describe("applicable_if conditions are non-empty across authn/weak-crypto CWEs", () => {
  it("every applicable_if reference has a non-empty trimmed condition", () => {
    const cweIds = ["CWE-307", "CWE-521", "CWE-327", "CWE-916"];
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

describe("CWE-307 schema rejection", () => {
  it("rejects a CWE-307 entry missing the required NIS2 reference", () => {
    const candidate = {
      cwe_id: "CWE-307",
      title: "Improper Restriction of Excessive Authentication Attempts",
      mitre_url: "https://cwe.mitre.org/data/definitions/307.html",
      impacts: ["x"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-307",
          description: "Improper Restriction of Excessive Authentication Attempts",
          source_url: "https://cwe.mitre.org/data/definitions/307.html",
          applicability: "informational",
        },
      ],
    };
    const result = ComplianceMappingEntrySchema.safeParse(candidate);
    expect(result.success).toBe(false);
    const failureText = result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
    expect(failureText).toContain("CWE-307");
    expect(failureText).toContain("NIS2");
  });
});

describe("CWE-327 schema rejection", () => {
  it("rejects a CWE-327 entry missing the required GDPR reference", () => {
    const candidate = {
      cwe_id: "CWE-327",
      title: "Use of a Broken or Risky Cryptographic Algorithm",
      mitre_url: "https://cwe.mitre.org/data/definitions/327.html",
      impacts: ["x"],
      references: [
        {
          framework: "CWE",
          identifier: "CWE-327",
          description: "Use of a Broken or Risky Cryptographic Algorithm",
          source_url: "https://cwe.mitre.org/data/definitions/327.html",
          applicability: "informational",
        },
      ],
    };
    const result = ComplianceMappingEntrySchema.safeParse(candidate);
    expect(result.success).toBe(false);
    const failureText = result.success ? "" : result.error.issues.map((i) => i.message).join("\n");
    expect(failureText).toContain("CWE-327");
    expect(failureText).toContain("GDPR");
  });
});
