// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/secrets.ts",
  line_start: 42,
  line_end: 42,
  title: "Secret provenance leak",
  body: "The walkthrough should not render non-provenance secret-shaped values.",
  source: "llm",
  confidence: 0.9,
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

interface SecretInputCase {
  readonly secretKind: "llm_api_key" | "github_token" | "raw_webhook_field";
  readonly secretValue: string;
}

const anthropicTestKey = `${["sk", "ant", "test", "secret"].join("-")}-${"1234567890".repeat(2)}`;
const githubTestToken = ["ghp", "_", "1234567890".repeat(3), "123456"].join("");
const webhookSignatureField = ["X-Hub-Signature", "-256=sha256=", "deadbeef"].join("");

const secretInputCases: readonly SecretInputCase[] = [
  { secretKind: "llm_api_key", secretValue: anthropicTestKey },
  { secretKind: "github_token", secretValue: githubTestToken },
  { secretKind: "raw_webhook_field", secretValue: webhookSignatureField },
];

describe("composeWalkthrough compliance secret-safe provenance output", () => {
  it.each(secretInputCases)("does not render non-provenance $secretKind values", (testCase) => {
    // Given the review has one finding
    // And the input contains a non-provenance secret-shaped value
    const review = {
      ...baseReview,
      [testCase.secretKind]: testCase.secretValue,
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then the output does not contain the secret-shaped value
    expect(markdown).not.toContain(testCase.secretValue);
  });

  it("renders signed audit entries as opaque non-secret identifiers", () => {
    // Given the optional provenance payload has signed_audit_entry "review-42-entry-3"
    // And the review has one finding
    const review = {
      ...baseReview,
      provenance: {
        signed_audit_entry: "review-42-entry-3",
      },
    };

    // When the walkthrough compliance block is rendered
    const markdown = composeWalkthrough(review);

    // Then it contains "Signed audit entry: review-42-entry-3"
    expect(markdown).toContain("Signed audit entry: review-42-entry-3");
  });
});
