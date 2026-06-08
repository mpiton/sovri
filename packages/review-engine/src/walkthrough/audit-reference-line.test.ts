// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceReference, Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const gdprReference: ComplianceReference = {
  framework: "GDPR",
  identifier: "Art. 32",
  description: "Security of processing",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "applicable_if",
  condition: "system processes personal data",
};

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/auth/session.ts",
  line_start: 42,
  line_end: 45,
  title: "Unvalidated session token",
  body: "The handler accepts a token without signature validation.",
  recommendation: "Validate the token signature before accepting it.",
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
  started_at: new Date("2026-05-28T08:00:00.000Z"),
  completed_at: new Date("2026-05-28T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "The PR has actionable review findings.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

function reviewWith(...findings: Finding[]): Review {
  return { ...baseReview, findings };
}

describe("composeWalkthrough audit reference line", () => {
  // Rule: R-03
  it("renders the audit reference for an enriched finding", () => {
    // Given a finding with audit reference "SOVRI-SC-AB12-CD34" and a GDPR compliance reference
    const review = reviewWith({
      ...baseFinding,
      audit_reference: "SOVRI-SC-AB12-CD34",
      compliance_references: [gdprReference],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough contains the audit reference line
    expect(markdown).toContain("🔍 Audit Reference: SOVRI-SC-AB12-CD34");
  });

  // Rule: R-03
  it("renders the audit reference for a finding with no compliance references", () => {
    // Given a finding with audit reference "SOVRI-BU-1A2B-3C4D" and no compliance references
    const review = reviewWith({
      ...baseFinding,
      audit_reference: "SOVRI-BU-1A2B-3C4D",
      compliance_references: [],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the audit reference line is present
    expect(markdown).toContain("🔍 Audit Reference: SOVRI-BU-1A2B-3C4D");
    // And no compliance block is rendered
    expect(markdown).not.toContain("📋 Potential compliance references");
  });

  // Rule: R-03
  it("renders a placeholder when the finding has no audit reference", () => {
    // Given a finding without an audit reference
    const { audit_reference: _omitted, ...withoutAuditReference } = baseFinding;
    const review = reviewWith({ ...withoutAuditReference, compliance_references: [] });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the audit reference line shows the n/a placeholder
    expect(markdown).toContain("🔍 Audit Reference: n/a");
  });

  // Rule: R-03
  it("renders an audit reference line for every finding", () => {
    // Given a review with two findings carrying distinct audit references
    const review = reviewWith(
      {
        ...baseFinding,
        title: "Unvalidated session token",
        audit_reference: "SOVRI-SC-AB12-CD34",
      },
      {
        ...baseFinding,
        id: "22222222-2222-4222-8222-222222222222",
        title: "Missing payload null guard",
        file: "src/api/review.ts",
        line_start: 18,
        line_end: 18,
        body: "The review payload is read before validation.",
        audit_reference: "SOVRI-BU-1A2B-3C4D",
      },
    );

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then each finding has its own audit reference line
    expect(markdown).toContain("🔍 Audit Reference: SOVRI-SC-AB12-CD34");
    expect(markdown).toContain("🔍 Audit Reference: SOVRI-BU-1A2B-3C4D");
  });
});
