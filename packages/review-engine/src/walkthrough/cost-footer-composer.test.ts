// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/api/review.ts",
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
  llm_provider: "anthropic",
  llm_model: "claude-sonnet-4-6",
  tokens_used: {
    prompt: 1234,
    completion: 567,
  },
  summary: "Review completed.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough cost footer", () => {
  it("keeps the walkthrough complete without a footer when token usage is undefined", () => {
    // Given a review for PR 36 in "mpiton/sovri"
    // And the review summary is "Review completed."
    // And the review uses provider "anthropic" with model "claude-sonnet-4-6"
    // And the review token usage is undefined
    const { tokens_used: _tokensUsed, ...reviewWithoutUsage } = baseReview;
    // And the review contains a major finding titled "Missing payload null guard"
    expect(reviewWithoutUsage.findings[0]?.title).toBe("Missing payload null guard");

    // When the walkthrough Markdown is composed
    const markdown = composeWalkthrough(reviewWithoutUsage);

    // Then the Markdown contains "## Sovri review"
    expect(markdown).toContain("## Sovri review");
    // And the Markdown contains "### TL;DR"
    expect(markdown).toContain("### TL;DR");
    // And the Markdown contains "### Findings"
    expect(markdown).toContain("### Findings");
    // And the Markdown contains "### File-by-file"
    expect(markdown).toContain("### File-by-file");
    // And the Markdown does not contain "Tokens:"
    expect(markdown).not.toContain("Tokens:");
    // And the Markdown does not contain "Estimated cost:"
    expect(markdown).not.toContain("Estimated cost:");
  });
});
