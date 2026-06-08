// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const promptSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/prompt.ts",
  line_start: 27,
  line_end: 27,
  title: "Prompt provenance missing",
  body: "The walkthrough should identify the prompt digest used for review.",
  recommendation:
    "Set prompt_sha256 in the provenance payload so the compliance block can render the digest line.",
  source: "llm",
  confidence: 0.89,
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

describe("composeWalkthrough compliance prompt digest provenance", () => {
  it("renders a valid prompt digest byte-for-byte", () => {
    // Given the optional provenance payload has prompt_sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    // And the review has one finding
    const review = {
      ...baseReview,
      provenance: {
        prompt_sha256: promptSha256,
      },
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Prompt sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(markdown).toContain(`Prompt sha256: ${promptSha256}`);
  });

  it("renders every supplied provenance field without the no-signed default", () => {
    const review = {
      ...baseReview,
      provenance: {
        prompt_sha256: promptSha256,
        hosting_region: "Mistral - Paris (EU)",
        data_residency: "EU only - 0 egress",
        signed_audit_entry: "#142-3 signed",
      },
    };

    const markdown = composeWalkthrough(review);

    expect(markdown).toContain(`Prompt sha256: ${promptSha256}`);
    expect(markdown).toContain("Hosting: Mistral - Paris (EU)");
    expect(markdown).toContain("Data residency: EU only - 0 egress");
    expect(markdown).toContain("Signed audit entry: #142-3 signed");
    expect(markdown).not.toContain("No signed audit trail is attached");
  });

  it("omits the prompt digest line and states no signed trail when provenance is absent", () => {
    // Given the review has one finding
    // And the optional provenance payload is absent
    const review = baseReview;

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it does not contain "Prompt sha256:"
    expect(markdown).not.toContain("Prompt sha256:");
    // And it contains "No signed audit trail is attached"
    expect(markdown).toContain("No signed audit trail is attached");
  });
});
