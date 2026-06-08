// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { ProviderFindingSchema } from "./index.js";

// Acceptance test for: "Provider finding schema accepts an optional CWE identifier"
// Rules: R-01 (schema accepts optional cwe), R-02 (provider MAY omit cwe),
//        R-05 (the model cannot supply compliance_references through the schema).
// Test level: @use-case — pure schema parse, no I/O.

const baseFinding = {
  severity: "major",
  category: "security",
  file: "src/auth.ts",
  line_start: 10,
  line_end: 12,
  title: "Hardcoded credential",
  body: "Avoid hardcoding credentials in source.",
  recommendation: "Load credentials from environment variables or a secrets manager instead.",
  confidence: 0.9,
} as const;

describe("ProviderFindingSchema CWE support", () => {
  // Rule: R-01, R-02
  it("accepts a provider finding carrying a valid CWE", () => {
    // Given a provider finding for category "security" with cwe "CWE-798"
    const finding = { ...baseFinding, cwe: "CWE-798" };

    // When the ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing succeeds
    expect(result.success).toBe(true);
    // And the parsed finding's cwe equals "CWE-798"
    if (result.success) {
      expect(result.data.cwe).toBe("CWE-798");
    }
  });

  // Rule: R-02
  it("accepts a provider finding without a CWE and leaves cwe undefined", () => {
    // Given a provider finding for category "bug" with no cwe field
    const finding = { ...baseFinding, category: "bug" };

    // When the ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing succeeds
    expect(result.success).toBe(true);
    // And the parsed finding's cwe is undefined
    if (result.success) {
      expect(result.data.cwe).toBeUndefined();
    }
  });

  it("accepts provider suggested code as parser-only input", () => {
    // Given a provider finding includes suggested_code as one line of replacement code
    const finding = {
      ...baseFinding,
      suggested_code: "return guardedReview;",
    };

    // When the ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing succeeds
    expect(result.success).toBe(true);
    // And the parsed suggested_code is preserved exactly for deterministic post-processing
    if (result.success) {
      expect(result.data.suggested_code).toBe("return guardedReview;");
    }
  });

  // Rule: R-01 (boundary — well-formed CWE values)
  it.each(["CWE-0", "CWE-79", "CWE-1004"])("accepts the well-formed CWE identifier %s", (cwe) => {
    // Given a provider finding for category "security" with cwe "<cwe>"
    const finding = { ...baseFinding, cwe };

    // When the ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing succeeds
    expect(result.success).toBe(true);
    // And the parsed finding's cwe equals "<cwe>"
    if (result.success) {
      expect(result.data.cwe).toBe(cwe);
    }
  });

  // Rule: R-01 (violation — malformed CWE values, including empty string)
  it.each(["", "798", "CWE-", "cwe-798", "CWE-79a", "CWE-7 9"])(
    "rejects the malformed CWE identifier %j",
    (cwe) => {
      // Given a provider finding for category "security" with cwe "<cwe>"
      const finding = { ...baseFinding, cwe };

      // When the ProviderFindingSchema parses it
      const result = ProviderFindingSchema.safeParse(finding);

      // Then parsing fails with a validation error on the "cwe" field
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join(".") === "cwe")).toBe(true);
      }
    },
  );

  // Rule: R-05
  it("rejects a payload that smuggles compliance_references through the schema", () => {
    // Given a provider finding for category "security" with cwe "CWE-798"
    // And the same payload also includes a "compliance_references" array with one entry
    const finding = {
      ...baseFinding,
      cwe: "CWE-798",
      compliance_references: [{ framework: "GDPR", control_id: "art-32" }],
    };

    // When the strict ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing fails with an unrecognized-key error for "compliance_references"
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasUnrecognizedKeys = result.error.issues.some(
        (issue) => issue.code === "unrecognized_keys",
      );
      expect(hasUnrecognizedKeys).toBe(true);
      expect(JSON.stringify(result.error.issues)).toContain("compliance_references");
    }
  });

  it("rejects a payload that smuggles a deterministic suggestion through the schema", () => {
    // Given a provider finding includes the public Finding.suggestion shape directly
    const finding = {
      ...baseFinding,
      suggestion: { code: "return guardedReview;", committable: true },
    };

    // When the strict ProviderFindingSchema parses it
    const result = ProviderFindingSchema.safeParse(finding);

    // Then parsing fails with an unrecognized-key error for "suggestion"
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasUnrecognizedKeys = result.error.issues.some(
        (issue) => issue.code === "unrecognized_keys",
      );
      expect(hasUnrecognizedKeys).toBe(true);
      expect(JSON.stringify(result.error.issues)).toContain("suggestion");
    }
  });
});
