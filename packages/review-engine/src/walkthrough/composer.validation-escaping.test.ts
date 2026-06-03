// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-06 — composeWalkthrough keeps rejecting invalid input at its boundary and keeps escaping
// summary, title, body, and file-path content exactly as before the verdict refresh.

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 18,
  line_end: 18,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
  source: "llm",
  confidence: 0.87,
};

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "Review completed.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough validation and escaping (R-06)", () => {
  it("throws on invalid input and returns no markdown", () => {
    // Given a malformed review that omits the required "summary" field
    const { summary: _summary, ...invalidReview } = baseReview;
    let markdown: string | undefined;

    // When the walkthrough is composed
    const compose = (): void => {
      markdown = composeWalkthrough(invalidReview);
    };

    // Then composeWalkthrough throws a validation error
    expect(compose).toThrow();
    // And no walkthrough markdown is returned
    expect(markdown).toBeUndefined();
  });

  it("keeps table-special characters in a finding title and file path escaped", () => {
    // Given a finding titled "Reject | pipe and <b>bold</b>" in file "src/a|b.ts"
    const review: Review = {
      ...baseReview,
      findings: [{ ...baseFinding, title: "Reject | pipe and <b>bold</b>", file: "src/a|b.ts" }],
    };

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the title is escaped through the existing table-cell escaping
    expect(markdown).toContain("Reject \\| pipe and &lt;b&gt;bold&lt;/b&gt;");
    // And the file path is escaped through the existing table-cell escaping
    expect(markdown).toContain("src/a\\|b.ts");
    // And the raw markup is not emitted unescaped
    expect(markdown).not.toContain("<b>bold</b>");
  });

  it("keeps summary and finding-body special characters escaped", () => {
    // Given a summary "Totals: 3 | 2 pending" and a body "Avoid | pipes and <i>italics</i> in cells"
    const review: Review = {
      ...baseReview,
      summary: "Totals: 3 | 2 pending",
      findings: [{ ...baseFinding, body: "Avoid | pipes and <i>italics</i> in cells" }],
    };

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the summary is rendered through the existing markdown escaping (intact in TL;DR text)
    expect(markdown).toContain("Totals: 3 | 2 pending");
    // And the body is escaped through the existing table-cell escaping
    expect(markdown).toContain("Avoid \\| pipes and &lt;i&gt;italics&lt;/i&gt; in cells");
    // And the raw markup is not emitted unescaped
    expect(markdown).not.toContain("<i>italics</i>");
  });
});
