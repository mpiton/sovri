// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/hosting.ts",
  line_start: 19,
  line_end: 19,
  title: "Hosting provenance missing",
  body: "The walkthrough should identify hosting and residency provenance.",
  recommendation:
    "Add hosting_region and data_residency fields to the provenance payload before rendering.",
  source: "llm",
  confidence: 0.87,
  audit_reference: "SOVRI-SC-AB12-CD34",
  compliance_references: [],
};

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 42,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-06-04T10:00:00.000Z"),
  completed_at: new Date("2026-06-04T10:01:00.000Z"),
  llm_provider: "mistral",
  llm_model: "mistral-large-latest",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "The PR has one finding.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough compliance hosting and residency provenance", () => {
  it("renders supplied hosting and data-residency values", () => {
    // Given the optional provenance payload has hosting_region "Mistral - Paris (EU)"
    // And the optional provenance payload has data_residency "EU only - 0 egress"
    // And the review has one finding
    const review = {
      ...baseReview,
      provenance: {
        hosting_region: "Mistral - Paris (EU)",
        data_residency: "EU only - 0 egress",
      },
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Hosting: Mistral - Paris (EU)"
    expect(markdown).toContain("Hosting: Mistral - Paris (EU)");
    // And it contains "Data residency: EU only - 0 egress"
    expect(markdown).toContain("Data residency: EU only - 0 egress");
  });

  it("omits hosting and data-residency lines when provenance is absent", () => {
    // Given the review has one finding
    // And the optional provenance payload is absent
    const review = baseReview;

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it does not contain "Hosting:"
    expect(markdown).not.toContain("Hosting:");
    // And it does not contain "Data residency:"
    expect(markdown).not.toContain("Data residency:");
  });
});
