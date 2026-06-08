// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceFramework, ComplianceReference, Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/db.ts",
  line_start: 42,
  line_end: 42,
  title: "Hardcoded credentials detected",
  body: "The connection string contains a hardcoded password.",
  recommendation:
    "Remove the hardcoded password and load credentials from environment variables or a secrets manager.",
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

const gdprReference: ComplianceReference = {
  framework: "GDPR",
  identifier: "Art. 32",
  description: "Security of processing",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "applicable_if",
  condition: "system processes personal data",
};

const doraReference: ComplianceReference = {
  framework: "DORA",
  identifier: "Art. 9",
  description: "ICT risk management",
  source_url: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
  applicability: "applicable_if",
  condition: "financial entity ICT infrastructure",
};

const owaspReference: ComplianceReference = {
  framework: "OWASP-TOP10-2021",
  identifier: "A07:2021",
  description: "Identification and Authentication Failures",
  source_url: "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
  applicability: "informational",
};

function reviewWith(finding: Finding): Review {
  return { ...baseReview, findings: [finding] };
}

describe("composeWalkthrough compliance references block", () => {
  // Rule: R-01
  it("exposes a dedicated compliance and audit section after file-by-file", () => {
    // Given a review with one finding "Hardcoded credentials detected" carrying compliance references
    const review = reviewWith({
      ...baseFinding,
      compliance_references: [gdprReference, doraReference],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough contains the heading "### Compliance & audit"
    expect(markdown).toContain("### Compliance & audit");
    // And the "### Compliance & audit" section appears after the "### File-by-file" section
    expect(markdown.indexOf("### Compliance & audit")).toBeGreaterThan(
      markdown.indexOf("### File-by-file"),
    );
  });

  // Rule: R-01
  it("renders the compliance block for a finding carrying references", () => {
    // Given a finding "Hardcoded credentials detected" in "src/db.ts" at line 42
    // And the finding has GDPR and DORA compliance references
    const review = reviewWith({
      ...baseFinding,
      compliance_references: [gdprReference, doraReference],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough contains the line "📋 Potential compliance references"
    expect(markdown).toContain("📋 Potential compliance references");
  });

  // Rule: R-01
  it("omits the compliance block when the finding has no references", () => {
    // Given a finding "Duplicated branch" in "src/api/review.ts" at line 31
    // And the finding has no compliance references
    const review = reviewWith({
      ...baseFinding,
      title: "Duplicated branch",
      file: "src/api/review.ts",
      line_start: 31,
      line_end: 31,
      body: "The branch repeats an existing condition.",
      compliance_references: [],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough does not contain "📋 Potential compliance references"
    expect(markdown).not.toContain("📋 Potential compliance references");
  });

  // Rule: R-01
  it("omits the compliance and audit section for a review with no findings", () => {
    // Given a review with no findings
    const review: Review = { ...baseReview, findings: [] };

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough does not contain "### Compliance & audit"
    expect(markdown).not.toContain("### Compliance & audit");
  });

  // Rule: R-02
  it("renders the tree connectors for a multi-reference finding", () => {
    // Given a finding "Hardcoded credentials detected" with audit reference "SOVRI-SC-AB12-CD34"
    // And the finding has GDPR and DORA compliance references
    const review = reviewWith({
      ...baseFinding,
      audit_reference: "SOVRI-SC-AB12-CD34",
      compliance_references: [gdprReference, doraReference],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough renders the exact compliance tree block
    expect(markdown).toContain(
      [
        "📋 Potential compliance references",
        "├─ GDPR: Art. 32 — Security of processing (applicable if: system processes personal data)",
        "└─ DORA: Art. 9 — ICT risk management (applicable if: financial entity ICT infrastructure)",
        "🔍 Audit Reference: SOVRI-SC-AB12-CD34",
      ].join("\n"),
    );
  });

  // Rule: R-02
  it("renders two branch connectors and one closing connector for three references", () => {
    // Given a finding with GDPR, DORA and OWASP compliance references in declared order
    const review = reviewWith({
      ...baseFinding,
      audit_reference: "SOVRI-SC-AB12-CD34",
      compliance_references: [gdprReference, doraReference, owaspReference],
    });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then every node but the last uses ├─ and the last uses └─
    expect(markdown).toContain(
      [
        "📋 Potential compliance references",
        "├─ GDPR: Art. 32 — Security of processing (applicable if: system processes personal data)",
        "├─ DORA: Art. 9 — ICT risk management (applicable if: financial entity ICT infrastructure)",
        "└─ OWASP Top 10: A07:2021 — Identification and Authentication Failures",
        "🔍 Audit Reference: SOVRI-SC-AB12-CD34",
      ].join("\n"),
    );
  });

  // Rule: R-02
  it("renders a single reference with the last-node connector only", () => {
    // Given a finding with a single GDPR compliance reference
    const review = reviewWith({ ...baseFinding, compliance_references: [gdprReference] });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the walkthrough contains the single closing connector line
    expect(markdown).toContain(
      "└─ GDPR: Art. 32 — Security of processing (applicable if: system processes personal data)",
    );
    // And the walkthrough does not contain a branch connector
    expect(markdown).not.toContain("├─");
  });

  // Rule: R-04
  it.each<readonly [ComplianceFramework, string, string, string]>([
    ["GDPR", "GDPR", "Art. 32", "Security of processing"],
    ["DORA", "DORA", "Art. 9", "ICT risk management"],
    ["OWASP-TOP10-2021", "OWASP Top 10", "A07:2021", "Identification and Authentication Failures"],
    ["ISO27001-2022", "ISO 27001:2022", "A.5.17", "Authentication information"],
    ["NIS2", "NIS2", "Annex I", "Cryptography and access control"],
    ["AI-ACT", "AI Act", "Art. 15", "Accuracy, robustness and cybersecurity"],
    ["CRA", "CRA", "Annex I", "Essential cybersecurity requirements"],
  ])(
    "maps the %s framework to its human-readable label %s",
    (framework, label, identifier, description) => {
      // Given a finding with a single informational <framework> reference
      const reference: ComplianceReference = {
        framework,
        identifier,
        description,
        source_url: "https://example.org/ref",
        applicability: "informational",
      };
      const review = reviewWith({ ...baseFinding, compliance_references: [reference] });

      // When the walkthrough is composed
      const markdown = composeWalkthrough(review);

      // Then the reference line uses the human-readable label
      expect(markdown).toContain(`└─ ${label}: ${identifier} — ${description}`);
    },
  );

  // Rule: R-05
  it("appends the condition for an applicable_if reference", () => {
    // Given a finding with a single GDPR reference, applicability "applicable_if"
    const review = reviewWith({ ...baseFinding, compliance_references: [gdprReference] });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the reference line ends with the condition in parentheses
    expect(markdown).toContain(
      "└─ GDPR: Art. 32 — Security of processing (applicable if: system processes personal data)",
    );
  });

  // Rule: R-05
  it("omits the condition for an informational reference", () => {
    // Given a finding with a single OWASP reference, applicability "informational"
    const review = reviewWith({ ...baseFinding, compliance_references: [owaspReference] });

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review);

    // Then the reference line carries no parenthetical condition
    expect(markdown).toContain(
      "└─ OWASP Top 10: A07:2021 — Identification and Authentication Failures",
    );
    expect(markdown).not.toContain("(applicable if:");
  });
});
