// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-07 — the diff → prompt → LLM → findings pipeline flow renders only when explicitly enabled,
// as a single mermaid fence placed under the verdict header (before TL;DR); off by default.

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

const MERMAID_FENCE = "```mermaid";

describe("walkthrough pipeline flow (R-07)", () => {
  it("omits the mermaid flow with default options", () => {
    // Given a review with findings
    // When the walkthrough is composed with default options
    const markdown = composeWalkthrough(baseReview as unknown as WalkthroughInput);

    // Then the output contains no "```mermaid" fence
    expect(markdown).not.toContain(MERMAID_FENCE);
  });

  it("renders a single mermaid flow under the verdict header when enabled", () => {
    // Given a review with findings
    // When the walkthrough is composed with the pipeline flow enabled
    const markdown = composeWalkthrough(baseReview as unknown as WalkthroughInput, {
      pipelineFlow: true,
    });

    // Then the output contains exactly one "```mermaid" fence
    expect(markdown.match(/```mermaid/g)).toHaveLength(1);

    // And the fence references the nodes "diff", "prompt", "LLM", and "findings"
    const flowRegion = markdown.slice(
      markdown.indexOf(MERMAID_FENCE),
      markdown.indexOf("### TL;DR"),
    );
    for (const node of ["diff", "prompt", "LLM", "findings"]) {
      expect(flowRegion).toContain(node);
    }

    // And the mermaid fence appears after the verdict header and before "### TL;DR"
    expect(markdown.indexOf(MERMAID_FENCE)).toBeGreaterThan(markdown.indexOf("## "));
    expect(markdown.indexOf(MERMAID_FENCE)).toBeLessThan(markdown.indexOf("### TL;DR"));
  });
});
