// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-08 — the composed walkthrough keeps the canonical section order under the verdict header
// and emits only GitHub-safe markdown (no CSS, no gh-chrome.css; banner expressed as a heading).

const reviewWithEverySection = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  token_usage_reported: true,
  summary: "The PR needs a fix before merge.",
  findings: [
    {
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
    },
  ],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
} as unknown as WalkthroughInput;

describe("walkthrough section order and GitHub-safety (R-08)", () => {
  it("keeps the canonical block order under the verdict header", () => {
    // Given a review with findings, a compliance mapping, and reported token usage
    // When the walkthrough is composed
    const markdown = composeWalkthrough(reviewWithEverySection);

    // Then the verdict header heads the output
    expect(markdown.startsWith("## ")).toBe(true);

    // And these blocks appear in this top-to-bottom order
    const markers = [
      "### TL;DR",
      "### Findings",
      "### File-by-file",
      "### Compliance & audit",
      "_Tokens:",
    ];
    const indices = markers.map((marker) => markdown.indexOf(marker));
    for (const index of indices) {
      expect(index).toBeGreaterThan(0);
    }
    for (let position = 1; position < indices.length; position += 1) {
      expect(indices[position]).toBeGreaterThan(indices[position - 1] ?? -1);
    }
  });

  it("emits GitHub-safe markdown with no CSS", () => {
    // When the walkthrough is composed
    const markdown = composeWalkthrough(reviewWithEverySection);

    // Then the output carries no CSS class or style attribute and no gh-chrome.css reference
    expect(markdown).not.toContain("class=");
    expect(markdown).not.toContain("style=");
    expect(markdown).not.toContain("gh-chrome.css");
    // And the verdict banner is a markdown heading with an emoji glyph, not a styled element
    expect(markdown).toMatch(/^## (✅ Approve|❌ Request changes)/u);
  });
});
