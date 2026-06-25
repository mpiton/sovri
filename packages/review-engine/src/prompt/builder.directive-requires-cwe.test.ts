// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// R-02 (issue #2625): the CWE directive must positively instruct the model to attach a `cwe` to any
// security, bug, or compliance finding tied to a known weakness — not only the soft "omit otherwise"
// escape hatch. The omission is scoped to a finding with no associated weakness, so the model is
// biased to emit a CWE exactly where compliance enrichment can fire.

import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./builder.js";

// The directive carries a positive obligation, applied to every security/bug/compliance weakness, not
// a soft "for a finding, set cwe ... omit otherwise". This phrase is the load-bearing positive instruction.
const POSITIVE_CWE_INSTRUCTION =
  "On every security, bug, or compliance finding tied to a known weakness, set `cwe`";

describe("R-02: the CWE directive tells the model to attach a CWE to security, bug, and compliance findings", () => {
  // Background: Sovri's review engine assembles the LLM review prompt.

  describe("Scenario Outline: the directive requires a CWE for each weakness category that maps", () => {
    it.each(["security", "bug", "compliance"] as const)(
      "the CWE directive instructs the model to attach a CWE to a %s finding tied to a known weakness",
      (category) => {
        // When the review engine builds the system prompt for the "full" mode
        const systemPrompt = buildSystemPrompt({ mode: "full" });

        // Then the CWE directive instructs the model to attach a CWE to a <category> finding tied to a known weakness
        expect(systemPrompt).toContain(POSITIVE_CWE_INSTRUCTION);
        expect(systemPrompt).toContain(category);
      },
    );
  });

  describe("Scenario Outline: every review mode carries the positive CWE instruction", () => {
    it.each(["full", "bugs-only", "strict", "minimal"] as const)(
      'the "%s" mode carries the positive CWE instruction for security and bug findings',
      (mode) => {
        // When the review engine builds the system prompt for the "<mode>" mode
        const systemPrompt = buildSystemPrompt({ mode });

        // Then the CWE directive instructs the model to attach a CWE to security and bug findings tied to a known weakness
        expect(systemPrompt).toContain(POSITIVE_CWE_INSTRUCTION);
      },
    );
  });

  it("a finding with no associated weakness is not forced to carry a CWE", () => {
    // When the review engine builds the system prompt for the "full" mode
    const systemPrompt = buildSystemPrompt({ mode: "full" });

    // Then the CWE directive tells the model to omit the CWE on a finding with no associated weakness
    expect(systemPrompt).toContain("omit `cwe`");
    expect(systemPrompt.toLowerCase()).toContain("no associated weakness");
  });
});
