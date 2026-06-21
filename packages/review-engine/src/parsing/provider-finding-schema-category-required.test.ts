// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { shouldEnrichCompliance } from "../compliance-gate.js";
import { ProviderFindingSchema } from "./index.js";

// Acceptance test for bug-2608 R-02: the provider finding schema requires a category.
// Feature: specs/bug-2608-cwe-category-schema-defaults/r-02-category-required.feature
// Test level: @use-case — pure schema parse, no I/O.

// Background: an LLM finding for "auth.ts" lines 12-14 titled "SQL injection" carrying cwe "CWE-89".
const baseFinding = {
  severity: "blocker",
  file: "auth.ts",
  line_start: 12,
  line_end: 14,
  title: "SQL injection",
  body: "User input is concatenated directly into a SQL query.",
  recommendation: "Use a parameterized query so the input cannot alter the statement.",
  cwe: "CWE-89",
} as const;

describe("ProviderFindingSchema requires a category (bug-2608 R-02)", () => {
  // @violation
  it("a finding with no category is rejected, not coerced to maintainability", () => {
    // Given the finding has no category
    const finding = { ...baseFinding };

    // When the provider finding contract parses the finding
    const result = ProviderFindingSchema.safeParse(finding);

    // Then the finding is rejected
    expect(result.success).toBe(false);
    if (!result.success) {
      // And the validation error points at the category field
      const categoryIssue = result.error.issues.find(
        (issue) => issue.path.join(".") === "category",
      );
      expect(categoryIssue).toBeDefined();
    } else {
      // And the finding is not silently parsed with category "maintainability"
      // (only reachable if the dropped default ever returns — guards the regression)
      expect(result.data.category).not.toBe("maintainability");
    }
  });

  // @nominal
  it("a security finding keeps its category and stays compliance-eligible", () => {
    // Given the finding has category "security"
    const finding = { ...baseFinding, category: "security" };

    // When the provider finding contract parses the finding
    const result = ProviderFindingSchema.safeParse(finding);

    // Then the finding is accepted with category "security"
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("security");
      // And the finding is eligible for compliance enrichment
      expect(shouldEnrichCompliance(result.data)).toBe(true);
    }
  });

  // @nominal — every valid category is accepted as given, none defaulted.
  // Covers all CategorySchema members so "every valid category" matches the enum contract.
  it.each([
    "security",
    "bug",
    "performance",
    "maintainability",
    "style",
    "documentation",
    "test-coverage",
  ])("the category %s is accepted as given", (category) => {
    // Given the finding has category "<category>"
    const finding = { ...baseFinding, category };

    // When the provider finding contract parses the finding
    const result = ProviderFindingSchema.safeParse(finding);

    // Then the finding is accepted with category "<category>"
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe(category);
    }
  });
});
