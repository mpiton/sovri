// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { WalkthroughInputSchema } from "./index.js";

const validPromptSha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/provenance.ts",
  line_start: 31,
  line_end: 31,
  title: "Provenance validation missing",
  body: "The walkthrough should reject malformed provenance before rendering markdown.",
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

interface InvalidProvenanceCase {
  readonly field: "prompt_sha256" | "hosting_region" | "data_residency";
  readonly value: string;
}

const invalidProvenanceCases: readonly InvalidProvenanceCase[] = [
  { field: "prompt_sha256", value: "abc" },
  { field: "prompt_sha256", value: "A".repeat(64) },
  { field: "hosting_region", value: "" },
  { field: "hosting_region", value: "   " },
  { field: "data_residency", value: "" },
  { field: "data_residency", value: "   " },
];

describe("walkthrough provenance payload validation", () => {
  it.each(invalidProvenanceCases)(
    "rejects invalid $field before markdown rendering",
    (testCase) => {
      // Given the review input includes provenance with the invalid field value
      const review = {
        ...baseReview,
        provenance: {
          [testCase.field]: testCase.value,
        },
      };

      // When the walkthrough input is validated
      const parsed = WalkthroughInputSchema.safeParse(review);

      // Then validation fails before markdown rendering
      expect(parsed.success).toBe(false);
      // And the failure path mentions the invalid field
      if (!parsed.success) {
        const issuePaths = parsed.error.issues.map((issue) => issue.path.map(String));
        expect(issuePaths.some((path) => path.includes(testCase.field))).toBe(true);
      }
    },
  );

  it("accepts a complete valid provenance payload", () => {
    // Given the review input includes valid prompt, hosting, and residency provenance
    const review = {
      ...baseReview,
      provenance: {
        prompt_sha256: validPromptSha256,
        hosting_region: "Mistral - Paris (EU)",
        data_residency: "EU only - 0 egress",
      },
    };

    // When the walkthrough input is validated
    const parsed = WalkthroughInputSchema.safeParse(review);

    // Then validation succeeds
    expect(parsed.success).toBe(true);
  });

  it("trims optional provenance evidence fields before rendering", () => {
    // Given the review input includes provenance strings with surrounding whitespace
    const review = {
      ...baseReview,
      provenance: {
        hosting_region: "  Mistral - Paris (EU)  ",
        data_residency: "  EU only - 0 egress  ",
        signed_audit_entry: "  review-42-entry-3  ",
      },
    };

    // When the walkthrough input is validated
    const parsed = WalkthroughInputSchema.safeParse(review);

    // Then validation succeeds and stores trimmed provenance evidence
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.provenance?.hosting_region).toBe("Mistral - Paris (EU)");
      expect(parsed.data.provenance?.data_residency).toBe("EU only - 0 egress");
      expect(parsed.data.provenance?.signed_audit_entry).toBe("review-42-entry-3");
    }
  });
});
