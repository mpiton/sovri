// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// R-03 (issue #2626): the CWE directive names the target compliance frameworks (GDPR, DORA, AI Act,
// NIS2). Naming the regulations Sovri maps to tells the model why a CWE is load-bearing and biases it
// toward emitting one on regulated findings. The prompt is model-facing prose, so it names the
// human-readable framework names ("AI Act"), not the schema enum id ("AI-ACT").

import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./builder.js";

describe("R-03: the CWE directive names the target compliance frameworks", () => {
  // Background: Sovri's review engine assembles the LLM review prompt.

  describe("Scenario Outline: the system prompt names each target framework", () => {
    it.each(["GDPR", "DORA", "AI Act", "NIS2"] as const)(
      'the CWE directive names the "%s" framework',
      (framework) => {
        // When the review engine builds the system prompt for the "compliance" mode
        const systemPrompt = buildSystemPrompt({ mode: "compliance" });

        // Then the CWE directive names the "<framework>" framework
        expect(systemPrompt).toContain(framework);
      },
    );
  });

  it("every review mode names the target frameworks", () => {
    // When the review engine builds the system prompt for the "compliance" mode
    const systemPrompt = buildSystemPrompt({ mode: "compliance" });

    // Then the CWE directive names GDPR, DORA, the AI Act, and NIS2
    expect(systemPrompt).toContain("GDPR");
    expect(systemPrompt).toContain("DORA");
    expect(systemPrompt).toContain("AI Act");
    expect(systemPrompt).toContain("NIS2");
  });
});
