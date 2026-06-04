// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ComplianceReference, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { renderComplianceSection } from "./compliance.js";

const gdprReference: ComplianceReference = {
  framework: "GDPR",
  identifier: "Art. 32",
  description: "Security & processing",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "applicable_if",
  condition: "system processes personal data",
};

const finding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/secrets.ts",
  line_start: 42,
  line_end: 42,
  title: "Hardcoded <password>",
  body: "The connection string contains a hardcoded password.",
  source: "llm",
  confidence: 0.9,
  audit_reference: "SOVRI-SC-AB12-CD34",
  compliance_references: [gdprReference],
};

const provenance = {
  llmProvider: "mistral",
  llmModel: "mistral-large-latest",
  promptSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  hostingRegion: "Mistral - Paris (EU)",
  dataResidency: "EU only - 0 egress",
};

describe("renderComplianceSection GitHub-safe markdown", () => {
  it("uses only GitHub-safe markdown primitives when provenance is present", () => {
    // Given a review has one finding
    // And the optional provenance payload is present
    const findings = [finding];

    // When the walkthrough compliance block is rendered
    const markdown = renderComplianceSection(findings, provenance).join("\n");

    // Then it contains "<details>"
    expect(markdown).toContain("<details>");
    // And it contains "<summary>Compliance &amp; provenance</summary>"
    expect(markdown).toContain("<summary>Compliance &amp; provenance</summary>");
    // And it does not contain "<style"
    expect(markdown).not.toContain("<style");
    // And it does not contain "class="
    expect(markdown).not.toContain("class=");
    // And it does not contain "style="
    expect(markdown).not.toContain("style=");
    // And it does not contain "gh-chrome"
    expect(markdown).not.toContain("gh-chrome");
  });

  it("escapes user-influenced finding titles and reference descriptions", () => {
    // Given a finding title is "Hardcoded <password>"
    // And a reference description is "Security & processing"
    const findings = [finding];

    // When the walkthrough compliance block is rendered
    const markdown = renderComplianceSection(findings, provenance).join("\n");

    // Then it contains "Hardcoded &lt;password&gt;"
    expect(markdown).toContain("Hardcoded &lt;password&gt;");
    // And it contains "Security &amp; processing"
    expect(markdown).toContain("Security &amp; processing");
  });
});
