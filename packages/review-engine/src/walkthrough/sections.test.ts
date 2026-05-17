// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 10,
  line_end: 10,
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
  tokens_used: {
    prompt: 1200,
    completion: 300,
  },
  summary: "Five review findings need attention.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough required sections", () => {
  it("renders every required section in order for a multi-finding review", () => {
    // Given the review contains a blocker finding titled "Unvalidated session token"
    // And the review contains a minor finding titled "Duplicated condition"
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseFinding,
          severity: "blocker",
          file: "src/auth/session.ts",
          line_start: 42,
          line_end: 45,
          title: "Unvalidated session token",
          body: "The handler accepts a token without signature validation.",
        },
        {
          ...baseFinding,
          id: "22222222-2222-4222-8222-222222222222",
          severity: "minor",
          file: "src/review.ts",
          line_start: 31,
          line_end: 31,
          title: "Duplicated condition",
          body: "The branch repeats an existing condition.",
        },
      ],
    };

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);

    // Then the markdown contains "## Sovri review"
    expect(markdown).toContain("## Sovri review");
    // And the markdown contains "### TL;DR"
    expect(markdown).toContain("### TL;DR");
    // And the markdown contains "### Findings"
    expect(markdown).toContain("### Findings");
    // And the markdown contains "### File-by-file"
    expect(markdown).toContain("### File-by-file");
    // And "### TL;DR" appears before "### Findings"
    expect(sectionIndex(markdown, "### TL;DR")).toBeLessThan(
      sectionIndex(markdown, "### Findings"),
    );
    // And "### Findings" appears before "### File-by-file"
    expect(sectionIndex(markdown, "### Findings")).toBeLessThan(
      sectionIndex(markdown, "### File-by-file"),
    );
  });
});

function sectionIndex(markdown: string, heading: string): number {
  const index = markdown.indexOf(heading);

  if (index < 0) {
    throw new Error(`Missing walkthrough section: ${heading}`);
  }

  return index;
}
