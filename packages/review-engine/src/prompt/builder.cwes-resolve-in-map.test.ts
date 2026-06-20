// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// R-01 (issue #2624): every CWE id the built prompt names must resolve in the compliance CWE map.
// A model imitates the prompt's worked example; an unmapped example (the retired CWE-287) makes the
// model emit an unmappable CWE and no framework reference renders. CWE-89 (SQL injection) is mapped.
//
// The compliance map is consulted through its public resolver, enrichFindingCompliance: a finding
// carrying a mapped CWE comes back with non-empty compliance_references; an unmapped CWE comes back
// empty. That is exactly "resolves in the compliance CWE map".

import { describe, expect, it } from "vitest";

import type { Finding } from "@sovri/core";
import { enrichFindingCompliance } from "@sovri/compliance";

import { buildSystemPrompt, buildUserPrompt } from "./builder.js";

const baseFinding: Finding = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  severity: "major",
  category: "security",
  file: "src/auth/login.ts",
  line_start: 42,
  line_end: 44,
  title: "Hardcoded credential detected",
  body: "A credential literal is committed to source control.",
  recommendation: "Move the secret to an environment variable.",
  source: "llm",
  confidence: 0.92,
  compliance_references: [],
};

// A CWE id "resolves in the compliance CWE map" when the public resolver returns references for it.
// An explicit cwe is used as-is (never overridden by ADR-020 derivation), so this probes the map key.
function resolvesInComplianceMap(cweId: string): boolean {
  const enriched = enrichFindingCompliance({ ...baseFinding, cwe: cweId });
  return enriched.compliance_references.length > 0;
}

function cweIdsNamedIn(prompt: string): string[] {
  return prompt.match(/CWE-\d+/g) ?? [];
}

// Background:
//   Given Sovri's review engine assembles the LLM review prompt
//   And a pull request #42 titled "Add login endpoint" in repository "acme/app"
const PULL_REQUEST = {
  number: 42,
  repoFullName: "acme/app",
  title: "Add login endpoint",
  description: null,
};
const ONE_LINE_DIFF = "+  const token = req.body.token;";

describe("R-01: the review prompt only names CWE ids the compliance map resolves", () => {
  describe("Scenario Outline: every CWE id named in the system prompt resolves in the compliance map", () => {
    it.each(["full", "bugs-only", "strict", "minimal"] as const)(
      'the "%s" mode system prompt names only CWE ids the compliance map resolves',
      (mode) => {
        // When the review engine builds the system prompt for the "<mode>" mode
        const systemPrompt = buildSystemPrompt({ mode });

        // Then every CWE id the prompt names resolves in the compliance CWE map
        for (const cweId of cweIdsNamedIn(systemPrompt)) {
          expect(
            resolvesInComplianceMap(cweId),
            `${cweId} must resolve in the compliance CWE map`,
          ).toBe(true);
        }
      },
    );
  });

  it("the few-shot worked example carries a mapped CWE", () => {
    // When the review engine builds the user prompt for pull request #42 over a one-line diff
    const userPrompt = buildUserPrompt(ONE_LINE_DIFF, PULL_REQUEST);

    // Then the worked finding example names CWE-89
    expect(userPrompt).toContain("CWE-89");
    // And CWE-89 resolves in the compliance CWE map
    expect(resolvesInComplianceMap("CWE-89")).toBe(true);
  });

  it("the retired CWE-287 never appears in any prompt surface", () => {
    // When the review engine builds the system prompt for the "full" mode
    const systemPrompt = buildSystemPrompt({ mode: "full" });
    // And the review engine builds the user prompt for pull request #42 over a one-line diff
    const userPrompt = buildUserPrompt(ONE_LINE_DIFF, PULL_REQUEST);

    // Then no prompt surface contains the unmapped id CWE-287
    expect(systemPrompt).not.toContain("CWE-287");
    expect(userPrompt).not.toContain("CWE-287");

    // And every CWE id either surface names resolves in the compliance CWE map
    for (const cweId of [...cweIdsNamedIn(systemPrompt), ...cweIdsNamedIn(userPrompt)]) {
      expect(
        resolvesInComplianceMap(cweId),
        `${cweId} must resolve in the compliance CWE map`,
      ).toBe(true);
    }
  });
});
