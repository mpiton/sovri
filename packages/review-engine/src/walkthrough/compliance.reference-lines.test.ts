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
  description: "Authentication failure",
  source_url: "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
  applicability: "informational",
};

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "security",
  file: "src/auth.ts",
  line_start: 88,
  line_end: 88,
  title: "Weak authentication handling",
  body: "Authentication fallback bypasses policy enforcement.",
  source: "llm",
  confidence: 0.91,
  audit_reference: "SOVRI-SC-AB12-CD34",
  compliance_references: [],
};

function findReferenceLine(
  lines: readonly string[],
  frameworkLabel: string,
  identifier: string,
): string {
  const line = lines.find(
    (candidate) => candidate.includes(frameworkLabel) && candidate.includes(identifier),
  );

  expect(line).toBeDefined();

  return line ?? "";
}

describe("renderComplianceSection reference lines", () => {
  it("renders framework label, identifier, description, and applicability condition", () => {
    // Given a finding has these compliance references:
    //   | framework        | identifier | description            | applicability | condition                           |
    //   | GDPR             | Art. 32    | Security of processing | applicable_if | system processes personal data      |
    //   | DORA             | Art. 9     | ICT risk management    | applicable_if | financial entity ICT infrastructure |
    //   | OWASP-TOP10-2021 | A07:2021   | Authentication failure | informational |                                     |
    const finding: Finding = {
      ...baseFinding,
      compliance_references: [gdprReference, doraReference, owaspReference],
    };

    // When the walkthrough compliance block is rendered
    const lines = renderComplianceSection([finding]);
    const markdown = lines.join("\n");

    // Then it contains a GDPR reference line with identifier "Art. 32"
    const gdprLine = findReferenceLine(lines, "GDPR", "Art. 32");
    // And the GDPR reference line contains "Security of processing"
    expect(gdprLine).toContain("Security of processing");
    // And the GDPR reference line contains "(applicable if: system processes personal data)"
    expect(gdprLine).toContain("(applicable if: system processes personal data)");
    // And it contains a DORA reference line with identifier "Art. 9"
    const doraLine = findReferenceLine(lines, "DORA", "Art. 9");
    // And the DORA reference line contains "ICT risk management"
    expect(doraLine).toContain("ICT risk management");
    // And the DORA reference line contains "(applicable if: financial entity ICT infrastructure)"
    expect(doraLine).toContain("(applicable if: financial entity ICT infrastructure)");
    // And it contains an OWASP Top 10 reference line with identifier "A07:2021"
    const owaspLine = findReferenceLine(lines, "OWASP Top 10", "A07:2021");
    // And the OWASP Top 10 reference line contains "Authentication failure"
    expect(owaspLine).toContain("Authentication failure");
    // And it does not contain "violation"
    expect(markdown).not.toContain("violation");
  });

  it("does not fabricate references for findings without compliance references", () => {
    // Given a finding has no compliance references
    const finding: Finding = {
      ...baseFinding,
      title: "Duplicated branch",
      body: "The branch repeats an existing condition.",
      audit_reference: "SOVRI-BU-1A2B-3C4D",
      compliance_references: [],
    };

    // When the walkthrough compliance block is rendered
    const markdown = renderComplianceSection([finding]).join("\n");

    // Then it does not contain "Potential compliance references"
    expect(markdown).not.toContain("Potential compliance references");
    // And it does not contain "GDPR"
    expect(markdown).not.toContain("GDPR");
    // And it still contains the finding audit reference line
    expect(markdown).toContain("🔍 Audit Reference: SOVRI-BU-1A2B-3C4D");
  });
});
