// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, computeVerdict, type WalkthroughInput } from "./index.js";

// Rule R-01 — a clean review (no findings) computes an approve verdict and leads with the Approve banner.

const cleanReview: Review = {
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
  summary: "No issues found.",
  findings: [],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("walkthrough verdict — clean review (R-01)", () => {
  it("computes an approve verdict when the review has no findings", () => {
    // Given a review with no findings
    const review = cleanReview;

    // When the verdict is computed from the findings
    const verdict = computeVerdict(review.findings);

    // Then the verdict kind is "approve"
    expect(verdict.kind).toBe("approve");
  });

  it("leads a clean walkthrough with the Approve banner", () => {
    // Given a review with no findings
    const review = cleanReview;

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);
    const lines = markdown.split("\n");

    // Then the composed output begins with the heading "## ✅ Approve"
    expect(lines[0]).toBe("## ✅ Approve");

    // And the count summary line reads "0 findings"
    const countIndex = lines.findIndex((line) => line.includes("0 findings"));
    expect(countIndex).toBeGreaterThan(0);

    // And the "### TL;DR" section appears immediately after the verdict header
    const tldrIndex = lines.findIndex((line) => line === "### TL;DR");
    expect(tldrIndex).toBeGreaterThan(countIndex);
    const headingsBetween = lines
      .slice(1, tldrIndex)
      .filter((line) => line.startsWith("## ") || line.startsWith("### "));
    expect(headingsBetween).toHaveLength(0);
  });
});
