// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { parseLLMResponse } from "./parser.js";

const UuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NonV4Uuid = "550e8400-e29b-11d4-a716-446655440000";

type RawFindingFixture = {
  severity: "major";
  category: "bug";
  file: string;
  line_start: number;
  line_end: number;
  title: string;
  body: string;
  suggested_code: string;
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
});
