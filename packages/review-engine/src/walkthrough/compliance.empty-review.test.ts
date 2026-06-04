// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { renderComplianceSection } from "./compliance.js";
import { composeWalkthrough } from "./index.js";

const promptSha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const cleanReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 42,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-06-04T10:00:00.000Z"),
  completed_at: new Date("2026-06-04T10:01:00.000Z"),
  llm_provider: "mistral",
  llm_model: "mistral-large-latest",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "The PR has no findings.",
  findings: [],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough compliance block for empty reviews", () => {
  it("omits the compliance block when a clean review has no provenance", () => {
    // Given the review has zero findings
    // And the optional provenance payload is absent
    const review = cleanReview;

    // When the walkthrough compliance block is rendered
    const block = renderComplianceSection(review.findings);
    const markdown = composeWalkthrough(review);

    // Then the returned block is empty
    expect(block).toEqual([]);
    // And the walkthrough output does not contain "<summary>Compliance &amp; provenance</summary>"
    expect(markdown).not.toContain("<summary>Compliance &amp; provenance</summary>");
  });

  it("renders provenance evidence for a clean review with provenance", () => {
    // Given the review has zero findings
    // And the optional provenance payload has prompt, hosting, and residency values
    const review = {
      ...cleanReview,
      provenance: {
        prompt_sha256: promptSha256,
        hosting_region: "Mistral - Paris (EU)",
        data_residency: "EU only - 0 egress",
      },
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "<summary>Compliance &amp; provenance</summary>"
    expect(markdown).toContain("<summary>Compliance &amp; provenance</summary>");
    // And it contains the prompt digest
    expect(markdown).toContain(`Prompt sha256: ${promptSha256}`);
  });
});
