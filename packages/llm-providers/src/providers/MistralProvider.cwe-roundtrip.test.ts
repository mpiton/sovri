// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { LLMResponseSchema } from "../schemas/LLMResponseSchema.js";
import { MistralProviderError } from "./MistralProvider.errors.js";
import { parseStructuredMistralResponse } from "./MistralProvider.response.js";
import { captureError, mistralCompletion } from "./MistralProvider.test-helpers.js";

// R-02 — a Mistral response that omits `cwe`, or sends `cwe: null` (which the
// R-01 strict schema now lets the model return), must still parse. A null cwe
// maps to "no cwe": the parsed finding carries no cwe, matching @sovri/core's
// `cwe?: string` (string-or-absent, never null). A malformed cwe is still
// rejected, and per-finding mapping holds across a multi-finding response.

// The scenario labels the severity "high"; the @sovri/core SeveritySchema enum has
// no "high" member, so the nearest faithful high-severity value, "major", is used.
const baseFinding = {
  severity: "major",
  category: "security",
  file: "src/auth.ts",
  line_start: 10,
  line_end: 12,
  title: "SQL injection in auth lookup",
  body: "User input is concatenated into the SQL query.",
};

function responseWith(findings: readonly Record<string, unknown>[]): unknown {
  return mistralCompletion({
    summary: "One finding in the auth handler.",
    findings,
    walkthrough_markdown: "Reviewed the auth handler changes.",
  });
}

function parse(findings: readonly Record<string, unknown>[]) {
  return parseStructuredMistralResponse(responseWith(findings), LLMResponseSchema, {
    prompt: 1,
    completion: 1,
  });
}

describe("Mistral responses round-trip whether cwe is present, omitted, or null", () => {
  // Background:
  //   Given Mistral findings use severity "high", category "security", file
  //   "src/auth.ts", lines 10 to 12, with a title and a body

  // @nominal — Scenario: Finding carrying a valid cwe parses and keeps it
  it("keeps a valid cwe", () => {
    // Given a response with one such finding whose "cwe" is "CWE-89"
    // When the response is parsed against the LLM response schema
    const parsed = parse([{ ...baseFinding, cwe: "CWE-89" }]);

    // Then parsing succeeds / And the parsed finding's "cwe" is "CWE-89"
    expect(parsed.findings[0]?.cwe).toBe("CWE-89");
  });

  // @nominal — Scenario: Finding omitting cwe parses as having no cwe
  it("parses a finding that omits cwe as having no cwe", () => {
    // Given a response with one such finding and no "cwe" field
    // When the response is parsed against the LLM response schema
    const parsed = parse([{ ...baseFinding }]);

    // Then parsing succeeds / And the parsed finding has no "cwe"
    expect(parsed.findings[0]?.cwe).toBeUndefined();
  });

  // @technical — Scenario: Finding with a null cwe parses as having no cwe
  it("maps a null cwe to no cwe", () => {
    // Given a response with one such finding whose "cwe" is null
    // When the response is parsed against the LLM response schema
    const parsed = parse([{ ...baseFinding, cwe: null }]);

    // Then parsing succeeds / And the parsed finding has no "cwe"
    expect(parsed.findings[0]?.cwe).toBeUndefined();
  });

  // @violation — Scenario: Finding with a malformed cwe is rejected
  it("rejects a malformed cwe and points the error at the cwe field", async () => {
    // Given a response with one such finding whose "cwe" is "89"
    // When the response is parsed against the LLM response schema
    const error = await captureError(
      Promise.resolve().then(() => parse([{ ...baseFinding, cwe: "89" }])),
    );

    // Then parsing fails / And the error points at the "cwe" field
    expect(error).toBeInstanceOf(MistralProviderError);
    const issues = error instanceof MistralProviderError ? error.issues : undefined;
    expect(issues?.some((issue) => issue.path.includes("cwe"))).toBe(true);
  });

  // @nominal — Scenario: A multi-finding response with mixed cwe presence round-trips per finding
  it("round-trips a mixed multi-finding response per finding", () => {
    // Given a response whose findings set "cwe" as CWE-89 / null / absent
    // When the response is parsed against the LLM response schema
    const parsed = parse([
      { ...baseFinding, cwe: "CWE-89" },
      { ...baseFinding, cwe: null },
      { ...baseFinding },
    ]);

    // Then parsing succeeds / per-finding cwe mapping holds
    expect(parsed.findings[0]?.cwe).toBe("CWE-89");
    expect(parsed.findings[1]?.cwe).toBeUndefined();
    expect(parsed.findings[2]?.cwe).toBeUndefined();
  });

  // @limit — Scenario: A response with no findings round-trips
  it("round-trips a response with no findings", () => {
    // Given a response with an empty findings list
    // When the response is parsed against the LLM response schema
    const parsed = parse([]);

    // Then parsing succeeds / And the parsed response has no findings
    expect(parsed.findings).toEqual([]);
  });
});
