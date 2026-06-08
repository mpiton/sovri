// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/audit.ts",
  line_start: 23,
  line_end: 23,
  title: "Signed audit entry missing",
  body: "The walkthrough should identify the signed audit entry when one exists.",
  recommendation:
    "Add a signed_audit_entry field to the provenance payload so the compliance block renders it.",
  source: "llm",
  confidence: 0.91,
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

describe("composeWalkthrough compliance signed audit entry provenance", () => {
  it("renders a supplied signed audit entry reference", () => {
    // Given the optional provenance payload has signed_audit_entry "#142-3 signed"
    // And the review has one finding
    const review = {
      ...baseReview,
      provenance: {
        signed_audit_entry: "#142-3 signed",
      },
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Signed audit entry: #142-3 signed"
    expect(markdown).toContain("Signed audit entry: #142-3 signed");
    // And it does not contain "No signed audit trail is attached"
    expect(markdown).not.toContain("No signed audit trail is attached");
  });

  it("states that no signed audit trail is attached when provenance is absent", () => {
    // Given the review has one finding
    // And the optional provenance payload is absent
    const review = baseReview;

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "No signed audit trail is attached"
    expect(markdown).toContain("No signed audit trail is attached");
    // And it does not contain "Signed audit entry:"
    expect(markdown).not.toContain("Signed audit entry:");
  });
});
