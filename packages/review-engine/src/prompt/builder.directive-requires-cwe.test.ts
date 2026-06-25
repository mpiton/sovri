// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// R-02 (issue #2625, revised for the compliance pivot — ADR-021, MAT-76): every Sovri finding is now
// a security or correctness weakness that should anchor a CWE → framework reference, so the CWE
// directive is unconditional. There is no longer a non-compliance category to exempt, so the prompt
// must no longer carry the "style or performance" omission escape hatch.

import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./builder.js";

// The directive carries an unconditional obligation: set `cwe` on every finding. This phrase is the
// load-bearing positive instruction.
const POSITIVE_CWE_INSTRUCTION = "On every finding, set `cwe` to its CWE id";

describe("R-02: the CWE directive tells the model to attach a CWE to every finding (ADR-021)", () => {
  // Background: Sovri's review engine assembles the LLM review prompt.

  describe("Scenario Outline: every review mode carries the positive CWE instruction", () => {
    it.each(["full", "bugs-only", "strict", "minimal"] as const)(
      'the "%s" mode carries the unconditional CWE instruction',
      (mode) => {
        // When the review engine builds the system prompt for the "<mode>" mode
        const systemPrompt = buildSystemPrompt({ mode });

        // Then the CWE directive instructs the model to attach a CWE to every finding
        expect(systemPrompt).toContain(POSITIVE_CWE_INSTRUCTION);
      },
    );
  });

  it("no longer carries the pre-pivot omission escape hatch for non-compliance findings", () => {
    // The generic categories the omission referenced (style, performance) were removed in the
    // compliance pivot, so the prompt must not tell the model to omit a CWE on them.
    const systemPrompt = buildSystemPrompt({ mode: "full" });

    // Then the prompt carries neither the omission instruction nor the removed category names
    expect(systemPrompt).not.toContain("omit `cwe`");
    expect(systemPrompt.toLowerCase()).not.toContain("style or performance");
  });
});
