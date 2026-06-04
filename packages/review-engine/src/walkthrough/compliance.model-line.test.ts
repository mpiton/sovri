// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/provider.ts",
  line_start: 17,
  line_end: 17,
  title: "Provider provenance missing",
  body: "The walkthrough should identify the model used for review.",
  source: "llm",
  confidence: 0.88,
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
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "The PR has one finding.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough compliance model provenance line", () => {
  it("shows the provider and model used for the review", () => {
    // Given the review provider is "mistral"
    // And the review model is "mistral-large-latest"
    // And the review has one finding
    const review: Review = {
      ...baseReview,
      llm_provider: "mistral",
      llm_model: "mistral-large-latest",
      findings: [baseFinding],
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Model: mistral / mistral-large-latest"
    expect(markdown).toContain("Model: mistral / mistral-large-latest");
  });

  it("escapes provider and model values before rendering", () => {
    // Given the review provider is "mistral <provider>"
    // And the review model is "large & fast"
    // And the review has one finding
    const review: Review = {
      ...baseReview,
      llm_provider: "mistral <provider>",
      llm_model: "large & fast",
      findings: [baseFinding],
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Model: mistral &lt;provider&gt; / large &amp; fast"
    expect(markdown).toContain("Model: mistral &lt;provider&gt; / large &amp; fast");
  });
});
