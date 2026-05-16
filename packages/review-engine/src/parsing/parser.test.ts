// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { parseLLMResponse } from "./parser.js";

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
      findings: [
        {
          severity: "major",
          category: "bug",
          file: "src/cards.ts",
          line_start: 8,
          line_end: 8,
          title: "Reject blocked card state",
          body: "Blocked cards are still treated as active.",
          suggested_code: "return false;",
          confidence: 0.87,
        },
      ],
    };

    // When the maintainer parses the LLM response
    const findings = parseLLMResponse(response);

    // Then parsing succeeds
    expect(findings).toHaveLength(1);

    const [finding] = findings;

    // And the returned finding id matches the UUID v4 format
    expect(finding?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    // And the returned finding validates against `FindingSchema`
    expect(FindingSchema.parse(finding)).toEqual(finding);
  });
});
