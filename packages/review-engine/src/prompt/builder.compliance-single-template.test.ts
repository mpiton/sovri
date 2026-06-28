// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildSystemPrompt, SYSTEM_PROMPT_MAX_BYTES } from "./builder.js";

// Rule R-03: buildSystemPrompt serves one compliance template for "compliance"
// and rejects any other mode. Mirrors
//   specs/mat-78-config-review-mode-compliance-only/r03-builder-single-template.feature.

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe("R-03 — the prompt builder serves a single compliance system template", () => {
  // @nominal
  // Scenario: Compliance mode returns the compliance system template within the byte cap
  it("returns a non-empty compliance template within the byte cap", () => {
    const prompt = buildSystemPrompt({ mode: "compliance" });

    expect(prompt.length).toBeGreaterThan(0);
    expect(utf8ByteLength(prompt)).toBeLessThanOrEqual(SYSTEM_PROMPT_MAX_BYTES);
  });

  // @nominal
  // Scenario: The surviving template keeps the post-pivot compliance scope
  it("keeps the compliance scope and the per-finding CWE directive", () => {
    const prompt = buildSystemPrompt({ mode: "compliance" });

    expect(prompt).toContain("security and correctness weaknesses that map to a known CWE");
    expect(prompt).toContain("set `cwe`");
  });

  // @violation
  // Scenario Outline: Any non-compliance mode is rejected by schema validation
  //   Then it throws a Zod validation error
  //   And no system prompt template is returned
  it.each(["full", "bugs-only", "strict", "minimal", "generic"])(
    "rejects non-compliance mode %j with a Zod error and returns no template",
    (mode) => {
      expect(() => buildSystemPrompt({ mode })).toThrow(z.ZodError);
    },
  );
});
