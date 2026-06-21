// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { zodToProviderJsonSchema } from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import { ProviderFindingSchema } from "./index.js";

// Acceptance test for bug-2608 R-01: the provider finding schema documents when to emit a CWE.
// Feature: specs/bug-2608-cwe-category-schema-defaults/r-01-cwe-field-documented.feature
// Test level: @use-case — pure schema parse + generated JSON schema, no I/O.

// Background: the review engine exposes its provider finding contract as a JSON schema for LLM
// providers. The generated schema's return type is intentionally loose (draft 2020-12 allows any
// keyword shape), so we narrow it to navigate to the cwe property at the assertion points; the
// runtime shape is still checked by the assertions below. Mirrors the llm-providers helper test.
interface JsonObjectSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonObjectSchema>;
}

const baseFinding = {
  severity: "blocker",
  category: "security",
  file: "auth.ts",
  line_start: 12,
  line_end: 14,
  title: "SQL injection",
  body: "User input is concatenated directly into a SQL query.",
  recommendation: "Use a parameterized query so the input cannot alter the statement.",
} as const;

describe("ProviderFindingSchema documents the cwe field (bug-2608 R-01)", () => {
  // @nominal
  it("the generated provider JSON schema documents the cwe field", () => {
    // When the provider JSON schema is generated from the provider finding contract
    const json = zodToProviderJsonSchema(ProviderFindingSchema) as JsonObjectSchema;
    const cwe = json.properties?.cwe;
    const description = cwe?.description ?? "";

    // Then the cwe property carries a non-empty description
    expect(description.length).toBeGreaterThan(0);
    // And the description tells the model to emit a CWE for any security or correctness weakness
    expect(description).toMatch(/security|correctness|weakness/i);
    // And the description states the expected CWE-<number> format
    expect(description).toContain("CWE-");
  });

  // @nominal
  it("cwe stays optional — a finding that omits it still parses", () => {
    // Given an otherwise valid finding with category "security" and no cwe
    const finding = { ...baseFinding };

    // When the provider finding contract parses the finding
    const result = ProviderFindingSchema.safeParse(finding);

    // Then the finding is accepted
    expect(result.success).toBe(true);
    // And the finding has no cwe
    if (result.success) {
      expect(result.data.cwe).toBeUndefined();
    }
  });

  // @limit — a cwe value is accepted only when it matches the documented CWE-<number> format
  it.each([
    { cwe: "CWE-89", outcome: "accepted" },
    { cwe: "CWE-79", outcome: "accepted" },
    { cwe: "89", outcome: "rejected" },
    { cwe: "CWE-", outcome: "rejected" },
    { cwe: "CWE-89x", outcome: "rejected" },
  ])("an otherwise valid finding whose cwe is $cwe is $outcome", ({ cwe, outcome }) => {
    // Given an otherwise valid finding with category "security" whose cwe is "<cwe>"
    const finding = { ...baseFinding, cwe };

    // When the provider finding contract parses the finding
    const result = ProviderFindingSchema.safeParse(finding);

    // Then the finding is "<outcome>"
    expect(result.success).toBe(outcome === "accepted");
  });
});
