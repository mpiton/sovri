// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, type Category, type Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { parseLLMResponse } from "./parser.js";

const UuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NonV4Uuid = "550e8400-e29b-11d4-a716-446655440000";

type RawFindingFixture = {
  severity: Severity;
  category: Category;
  file: string;
  line_start: number;
  line_end: number;
  title: string;
  body: string;
  suggested_code: string | null;
  confidence: number;
};

function buildRawFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return {
    severity: "major",
    category: "bug",
    file: "src/cards.ts",
    line_start: 8,
    line_end: 8,
    title: "Reject blocked card state",
    body: "Blocked cards are still treated as active.",
    suggested_code: "return false;",
    confidence: 0.87,
    ...overrides,
  };
}

describe("parseLLMResponse", () => {
  it("assigns a UUID v4 id to a parsed finding", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw LLM response contains a finding for file "src/cards.ts"
    // And the raw finding severity is "major"
    // And the raw finding category is "bug"
    // And the raw finding line_start is 8
    // And the raw finding line_end is 8
    // And the raw finding title is "Reject blocked card state"
    // And the raw finding body is "Blocked cards are still treated as active."
    // And the raw finding suggested_code is "return false;"
    // And the raw finding confidence is 0.87
    const response = {
      summary: "One finding found",
      findings: [buildRawFinding()],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(1);

    const [finding] = findings;

    // And the returned finding id matches the UUID v4 format
    expect(finding?.id).toMatch(UuidV4Pattern);

    // And the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("returns a Finding array for a valid response", () => {
    // Given the test fixture contains a valid response with summary "Review completed"
    // And the test fixture contains one finding for file "src/review.ts"
    const response = {
      summary: "Review completed",
      findings: [
        buildRawFinding({
          file: "src/review.ts",
        }),
      ],
    };

    // When the maintainer runs the parser tests
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the valid response test passes
    expect(findings).toHaveLength(1);

    // And the test asserts that a `Finding[]` is returned
    expect(Array.isArray(findings)).toBe(true);

    // And the test asserts that the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("throws a typed parse error for a schema-violating response", () => {
    // Given the test fixture contains a response with summary "Broken response"
    // And the test fixture contains a finding with line_start 22 and line_end 20
    const response = {
      summary: "Broken response",
      findings: [
        buildRawFinding({
          line_start: 22,
          line_end: 20,
        }),
      ],
    };

    let parsedFindings: ReturnType<typeof parseLLMResponse> | undefined;
    let thrownError: unknown;

    // When the maintainer runs the parser tests
    try {
      parsedFindings = parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then the schema-violating response test passes
    expect(thrownError).toBeInstanceOf(Error);

    // And the test asserts that parsing fails with a typed LLM response parse error
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
    });

    // And the test asserts that no partial findings are returned
    expect(parsedFindings).toBeUndefined();
  });

  it("throws a findings limit validation error for an oversized response", () => {
    // Given the test fixture contains a response with summary "Too many findings"
    // And the test fixture contains 101 findings
    const response = {
      summary: "Too many findings",
      findings: Array.from({ length: 101 }, (_, index) =>
        buildRawFinding({
          file: `src/review-${index}.ts`,
        }),
      ),
    };

    let thrownError: unknown;

    // When the maintainer runs the parser tests
    try {
      parseLLMResponse(response);
    } catch (error) {
      thrownError = error;
    }

    // Then the oversized response test passes
    expect(thrownError).toBeInstanceOf(Error);

    // And the test asserts that parsing fails with a findings limit validation error
    expect(thrownError).toMatchObject({
      name: "LLMResponseParseError",
      issues: [
        expect.objectContaining({
          code: "too_big",
          path: ["findings"],
        }),
      ],
    });
  });

  it("assigns separate UUID v4 ids to multiple parsed findings", () => {
    // Given the raw LLM response summary is "One finding found"
    // And the raw LLM response contains a finding for file "src/cards.ts"
    // And the raw finding severity is "major"
    // And the raw finding category is "bug"
    // And the raw finding line_start is 8
    // And the raw finding line_end is 8
    // And the raw finding title is "Reject blocked card state"
    // And the raw finding body is "Blocked cards are still treated as active."
    // And the raw finding suggested_code is "return false;"
    // And the raw finding confidence is 0.87
    // Given the raw LLM response contains 3 valid findings
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding(),
        buildRawFinding({
          file: "src/deck.ts",
          line_start: 12,
          line_end: 12,
          title: "Reject empty deck state",
          body: "Empty decks are still treated as drawable.",
        }),
        buildRawFinding({
          file: "src/limits.ts",
          line_start: 21,
          line_end: 21,
          title: "Reject negative limit",
          body: "Negative limits are still accepted.",
        }),
      ],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(3);

    const ids = findings.map(({ id }) => id);

    // And each returned finding id matches the UUID v4 format
    for (const id of ids) {
      expect(id).toMatch(UuidV4Pattern);
    }

    // And the 3 returned finding ids are distinct
    expect(new Set(ids).size).toBe(3);
  });

  it("rejects a non-v4 id before a finding is returned", () => {
    // Given a parser regression assigns id "550e8400-e29b-11d4-a716-446655440000"
    const regressionFinding = {
      id: NonV4Uuid,
      severity: "major",
      category: "bug",
      file: "src/cards.ts",
      line_start: 8,
      line_end: 8,
      title: "Reject blocked card state",
      body: "Blocked cards are still treated as active.",
      source: "llm",
      confidence: 0.87,
    };

    // When the maintainer validates the parsed finding
    const validation = FindingSchema.safeParse(regressionFinding);

    // Then validation fails against `FindingSchema`
    expect(validation.success).toBe(false);

    const findings = parseLLMResponse({
      summary: "One finding found",
      findings: [buildRawFinding()],
    });

    // And no finding with the non-v4 id is returned
    expect(findings.map(({ id }) => id)).not.toContain(NonV4Uuid);
  });

  it("returns a committable suggestion for a non-empty single-line replacement", () => {
    // Given the raw finding has severity "minor"
    // And the raw finding has category "maintainability"
    // And the raw finding has file "src/totals.ts"
    // And the raw finding has title "Use explicit zero fallback"
    // And the raw finding has body "The total can be undefined before formatting."
    // And the raw finding has confidence 0.84
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is "const total = amount ?? 0;"
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: "const total = amount ?? 0;",
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer computes the committable value
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the committable result is true
    expect(finding?.suggestion?.committable).toBe(true);

    // And the suggestion is returned with code "const total = amount ?? 0;"
    expect(finding?.suggestion?.code).toBe("const total = amount ?? 0;");

    // And suggestion.committable is true
    expect(finding?.suggestion?.committable).toBe(true);
  });

  it("does not mark empty or multiline replacements as committable", () => {
    const examples = ["", "const total = amount ?? 0;\nreturn total;"];

    for (const suggestedCode of examples) {
      const findings = parseLLMResponse({
        summary: "One finding found",
        findings: [
          buildRawFinding({
            line_start: 14,
            line_end: 14,
            suggested_code: suggestedCode,
          }),
        ],
      });

      const [finding] = findings;

      expect(finding?.suggestion?.committable).toBe(false);
    }
  });

  it("marks non-committable suggestions as false", () => {
    const examples = [
      {
        line_start: 14,
        line_end: 16,
        suggested_code: "const total = amount ?? 0;",
        requiresSuggestion: true,
      },
      {
        line_start: 14,
        line_end: 14,
        suggested_code: "const total = amount ?? 0;\nreturn total;",
        requiresSuggestion: true,
      },
      {
        line_start: 14,
        line_end: 14,
        suggested_code: "",
        requiresSuggestion: true,
      },
      { line_start: 14, line_end: 14, suggested_code: "   ", requiresSuggestion: false },
      { line_start: 14, line_end: 14, suggested_code: null, requiresSuggestion: false },
    ];

    for (const { requiresSuggestion, ...example } of examples) {
      // Given the raw finding line_start is <line_start>
      // And the raw finding line_end is <line_end>
      // And the raw finding suggested_code is <suggested_code>
      const findings = parseLLMResponse({
        summary: "One finding found",
        findings: [
          buildRawFinding({
            severity: "minor",
            category: "maintainability",
            file: "src/totals.ts",
            title: "Use explicit zero fallback",
            body: "The total can be undefined before formatting.",
            confidence: 0.84,
            ...example,
          }),
        ],
      });

      const [finding] = findings;

      if (requiresSuggestion) {
        expect(finding?.suggestion).toBeDefined();

        // When the maintainer computes the committable value
        // Then the committable result is false
        expect(finding?.suggestion?.committable).toBe(false);
      } else {
        // When the maintainer computes the committable value
        // Then the committable result is false
        expect(finding?.suggestion?.committable).not.toBe(true);
      }
    }
  });

  it("returns no suggestion object for null suggested code", () => {
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is null
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: null,
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer converts the raw finding to a public Finding
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the returned finding has no suggestion
    expect(finding?.suggestion).toBeUndefined();

    // And the returned finding still validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });

  it("returns no suggestion object for whitespace-only suggested code", () => {
    // Given the raw finding line_start is 14
    // And the raw finding line_end is 14
    // And the raw finding suggested_code is "   "
    const response = {
      summary: "One finding found",
      findings: [
        buildRawFinding({
          severity: "minor",
          category: "maintainability",
          file: "src/totals.ts",
          line_start: 14,
          line_end: 14,
          title: "Use explicit zero fallback",
          body: "The total can be undefined before formatting.",
          suggested_code: "   ",
          confidence: 0.84,
        }),
      ],
    };

    // When the maintainer converts the raw finding to a public Finding
    const findings = parseLLMResponse(response);

    const [finding] = findings;

    // Then the returned finding has no suggestion
    expect(finding?.suggestion).toBeUndefined();

    // And the returned finding still validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });
});
