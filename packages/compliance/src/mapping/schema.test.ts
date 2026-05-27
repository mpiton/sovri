// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, expectTypeOf, it } from "vitest";
import { ZodError } from "zod";

import {
  ComplianceMappingEntrySchema,
  ComplianceReferenceEntrySchema,
  type ComplianceMappingEntry,
  type ComplianceReferenceEntry,
} from "../index.js";
import type { ComplianceMappingEntry as PublicComplianceMappingEntry } from "../index.js";

const baseReference = {
  framework: "CWE",
  identifier: "CWE-798",
  description: "Use of Hard-coded Credentials",
  source_url: "https://cwe.mitre.org/data/definitions/798.html",
  applicability: "informational",
} satisfies ComplianceReferenceEntry;

function buildEntry(
  referenceOverrides: Partial<ComplianceReferenceEntry> = {},
): ComplianceMappingEntry {
  return {
    cwe_id: "CWE-798",
    title: "Use of Hard-coded Credentials",
    mitre_url: "https://cwe.mitre.org/data/definitions/798.html",
    impacts: ["Credential compromise", "Unauthorized access"],
    references: [{ ...baseReference, ...referenceOverrides }],
  };
}

function buildRawEntry(referenceOverrides: Record<string, unknown>): unknown {
  return {
    cwe_id: "CWE-798",
    title: "Use of Hard-coded Credentials",
    mitre_url: "https://cwe.mitre.org/data/definitions/798.html",
    impacts: ["Credential compromise", "Unauthorized access"],
    references: [{ ...baseReference, ...referenceOverrides }],
  };
}

function expectZodError(value: unknown): ZodError {
  const result = ComplianceMappingEntrySchema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected ComplianceMappingEntrySchema to reject the value.");
  }
  return result.error;
}

describe("ComplianceMappingEntrySchema", () => {
  it("accepts supported applicability values from the scenario outline", () => {
    const examples = [
      {
        framework: "CWE",
        identifier: "CWE-798",
        applicability: "informational",
        condition: undefined,
      },
      {
        framework: "GDPR",
        identifier: "Art. 32",
        applicability: "applicable_if",
        condition: "Personal data is processed by the reviewed code",
      },
      {
        framework: "ISO27001-2022",
        identifier: "A.5.17",
        applicability: "applicable_if",
        condition: "Authentication information is present in the finding",
      },
      {
        framework: "OWASP-TOP10-2021",
        identifier: "A07:2021",
        applicability: "informational",
        condition: undefined,
      },
    ] satisfies readonly Partial<ComplianceReferenceEntry>[];

    for (const example of examples) {
      // Given a compliance mapping entry for "CWE-798"
      const entry = buildEntry(example);

      // When the mapping entry is parsed with ComplianceMappingEntrySchema
      const parsed = ComplianceMappingEntrySchema.parse(entry);

      // Then the parsing succeeds
      // And the parsed first reference applicability is "<applicability>"
      expect(parsed.references[0]?.applicability).toBe(example.applicability);
    }
  });

  it("rejects confirmed applicability", () => {
    const entry = buildRawEntry({
      framework: "DORA",
      identifier: "Art. 9",
      applicability: "confirmed",
      condition: "ICT risk management is in scope",
    });

    const error = expectZodError(entry);

    expect(error.issues.map((issue) => issue.path.join("."))).toContain(
      "references.0.applicability",
    );
  });

  it("exposes the exact automatic applicability domain", () => {
    expect(ComplianceReferenceEntrySchema.shape.applicability.options).toEqual([
      "applicable_if",
      "informational",
    ]);
    expect(ComplianceReferenceEntrySchema.shape.applicability.options).not.toContain("confirmed");
  });

  it("preserves an applicable-if condition", () => {
    const condition = "Personal data is processed by the reviewed code";
    const parsed = ComplianceMappingEntrySchema.parse(
      buildEntry({
        framework: "GDPR",
        identifier: "Art. 32",
        applicability: "applicable_if",
        condition,
      }),
    );

    expect(parsed.references[0]?.condition).toBe(condition);
  });

  it.each([
    { name: "omitted", condition: undefined },
    { name: "empty string", condition: "" },
  ])("rejects applicable-if reference with $name condition", ({ condition }) => {
    const entry = buildEntry({
      framework: "NIS2",
      identifier: "Annex I 2.e",
      applicability: "applicable_if",
      condition,
    });

    const error = expectZodError(entry);

    expect(error.issues.map((issue) => issue.path.join("."))).toContain("references.0.condition");
  });

  it("allows an informational reference without a condition", () => {
    const parsed = ComplianceMappingEntrySchema.parse(
      buildEntry({
        framework: "CWE",
        identifier: "CWE-798",
        applicability: "informational",
      }),
    );

    expect(parsed.references[0]?.condition).toBeUndefined();
  });

  it("uses a clear error message when applicable-if condition is omitted", () => {
    const entry = buildEntry({
      applicability: "applicable_if",
      condition: undefined,
    });

    const error = expectZodError(entry);
    const messages = error.issues.map((issue) => issue.message).join("\n");

    expect(messages).toContain("condition");
    expect(messages).toContain("applicable_if");
  });

  it("exports schema-derived mapping types from the schema module and package root", () => {
    expectTypeOf<PublicComplianceMappingEntry>().toEqualTypeOf<ComplianceMappingEntry>();
    expectTypeOf<ComplianceReferenceEntry>().toEqualTypeOf<
      typeof ComplianceReferenceEntrySchema._output
    >();
  });
});
