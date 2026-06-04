// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceReference, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { renderComplianceSection } from "./compliance.js";

const gdprReference: ComplianceReference = {
  framework: "GDPR",
  identifier: "Art. 32",
  description: "Security of processing",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "applicable_if",
  condition: "system processes personal data",
};

const hardcodedCredentialsFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/db.ts",
  line_start: 42,
  line_end: 42,
  title: "Hardcoded credentials detected",
  body: "The connection string contains a hardcoded password.",
  source: "llm",
  confidence: 0.9,
  audit_reference: "SOVRI-SC-AB12-CD34",
  compliance_references: [gdprReference],
};

describe("renderComplianceSection provenance wrapper", () => {
  it("renders non-empty compliance output as default-collapsed GitHub details markup", () => {
    // Given a review has one finding titled "Hardcoded credentials detected"
    // And the finding has audit reference "SOVRI-SC-AB12-CD34"
    // And the finding has one GDPR compliance reference
    const findings = [hardcodedCredentialsFinding];

    // When the walkthrough compliance block is rendered
    const block = renderComplianceSection(findings);

    // Then the first line is "<details>"
    expect(block[0]).toBe("<details>");
    // And the second line is "<summary>Compliance &amp; provenance</summary>"
    expect(block[1]).toBe("<summary>Compliance &amp; provenance</summary>");
    // And the last line is "</details>"
    expect(block.at(-1)).toBe("</details>");
    // And the opening details line does not contain "open"
    expect(block[0]).not.toContain("open");
  });

  it("does not render non-empty compliance output as a styled container", () => {
    // Given a review has one finding titled "Hardcoded credentials detected"
    const findings = [hardcodedCredentialsFinding];

    // When the walkthrough compliance block is rendered
    const block = renderComplianceSection(findings);
    const markdown = block.join("\n");

    // Then the block does not contain "class="
    expect(markdown).not.toContain("class=");
    // And the block does not contain "style="
    expect(markdown).not.toContain("style=");
  });
});
