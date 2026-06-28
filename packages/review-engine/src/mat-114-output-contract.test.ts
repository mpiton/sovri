// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import * as reviewEngine from "./index.js";

const cataloguedControl = {
  control_id: "gdpr-eprivacy-consent-tracking",
  framework: "GDPR/ePrivacy",
  framework_reference: "GDPR Art. 5(1)(a)",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
  remediation_guidance: "Delay non-essential analytics until consent is recorded",
} as const;
const catalog = [cataloguedControl];

describe("MAT-114 GDPR/ePrivacy fixture renders through the output contract", () => {
  it("renders tracker-without-consent as a potential compliance gap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tracker-without-consent"
    // And the fixture has tracker evidence "web/app/layout.tsx:12 imports @vercel/analytics/react"
    // And the fixture consent evidence is "no consent banner, CMP integration, delayed activation, privacy route, or exemption"
    const controlResult = mat114GapControlResult({
      fixture: "tracker-without-consent",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      consent_evidence:
        "no consent banner, CMP integration, delayed activation, privacy route, or exemption",
      gap_id: "gap-tracker-consent-009",
      status: "WARNING",
      severity: "major",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output contains ComplianceGap "gap-tracker-consent-009"
    expect(output).toContain("ComplianceGap");
    expect(output).toContain("gap-tracker-consent-009");

    // And the rendered output shows status "WARNING"
    expect(output).toContain("WARNING");

    // And the rendered output shows severity "major"
    expect(output).toContain("major");

    // And the rendered output shows "potential compliance gap"
    expect(output).toContain("potential compliance gap");

    // And the rendered output shows framework "GDPR/ePrivacy"
    expect(output).toContain("GDPR/ePrivacy");

    // And the rendered output shows control id "gdpr-eprivacy-consent-tracking"
    expect(output).toContain("gdpr-eprivacy-consent-tracking");

    // And the rendered output shows source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    expect(output).toContain("https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng");

    // And the rendered output shows evidence "web/app/layout.tsx:12 imports @vercel/analytics/react"
    expect(output).toContain("web/app/layout.tsx:12 imports @vercel/analytics/react");

    // And the rendered output shows remediation guidance "Delay non-essential analytics until consent is recorded"
    expect(output).toContain("Delay non-essential analytics until consent is recorded");

    // And the rendered output does not say "GDPR violation"
    expect(output).not.toContain("GDPR violation");
  });

  it("renders tag-manager-before-consent as a potential compliance gap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tag-manager-before-consent"
    // And the fixture has tracker evidence "web/app/layout.tsx:18 initializes Google Tag Manager"
    // And the fixture consent evidence is "cookie banner exists but tracker activation is not delayed until consent is recorded"
    const controlResult = mat114GapControlResult({
      fixture: "tag-manager-before-consent",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:18 initializes Google Tag Manager",
      consent_evidence:
        "cookie banner exists but tracker activation is not delayed until consent is recorded",
      gap_id: "gap-tracker-consent-012",
      status: "FAIL",
      severity: "blocker",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output contains ComplianceGap "gap-tracker-consent-012"
    expect(output).toContain("ComplianceGap");
    expect(output).toContain("gap-tracker-consent-012");

    // And the rendered output shows status "FAIL"
    expect(output).toContain("FAIL");

    // And the rendered output shows severity "blocker"
    expect(output).toContain("blocker");

    // And the rendered output shows "potential compliance gap"
    expect(output).toContain("potential compliance gap");

    // And the rendered output shows framework "GDPR/ePrivacy"
    expect(output).toContain("GDPR/ePrivacy");

    // And the rendered output shows control id "gdpr-eprivacy-consent-tracking"
    expect(output).toContain("gdpr-eprivacy-consent-tracking");

    // And the rendered output shows source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    expect(output).toContain("https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng");

    // And the rendered output shows evidence "web/app/layout.tsx:18 initializes Google Tag Manager"
    expect(output).toContain("web/app/layout.tsx:18 initializes Google Tag Manager");

    // And the rendered output shows remediation guidance "Delay non-essential analytics until consent is recorded"
    expect(output).toContain("Delay non-essential analytics until consent is recorded");

    // And the rendered output does not say "GDPR violation"
    expect(output).not.toContain("GDPR violation");
  });

  it("renders tracker-inconclusive-consent as a potential compliance gap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tracker-inconclusive-consent"
    // And the fixture has tracker evidence "web/app/analytics.ts:9 loads analytics-js@2.4.0"
    // And the fixture consent evidence is "privacy route exists, but no consent record or documented strictly-necessary exemption"
    const controlResult = mat114GapControlResult({
      fixture: "tracker-inconclusive-consent",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/analytics.ts:9 loads analytics-js@2.4.0",
      consent_evidence:
        "privacy route exists, but no consent record or documented strictly-necessary exemption",
      gap_id: "gap-tracker-consent-013",
      status: "WARNING",
      severity: "major",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output contains ComplianceGap "gap-tracker-consent-013"
    expect(output).toContain("ComplianceGap");
    expect(output).toContain("gap-tracker-consent-013");

    // And the rendered output shows status "WARNING"
    expect(output).toContain("WARNING");

    // And the rendered output shows severity "major"
    expect(output).toContain("major");

    // And the rendered output shows "potential compliance gap"
    expect(output).toContain("potential compliance gap");

    // And the rendered output shows framework "GDPR/ePrivacy"
    expect(output).toContain("GDPR/ePrivacy");

    // And the rendered output shows control id "gdpr-eprivacy-consent-tracking"
    expect(output).toContain("gdpr-eprivacy-consent-tracking");

    // And the rendered output shows source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    expect(output).toContain("https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng");

    // And the rendered output shows evidence "web/app/analytics.ts:9 loads analytics-js@2.4.0"
    expect(output).toContain("web/app/analytics.ts:9 loads analytics-js@2.4.0");

    // And the rendered output shows remediation guidance "Delay non-essential analytics until consent is recorded"
    expect(output).toContain("Delay non-essential analytics until consent is recorded");

    // And the rendered output does not say "GDPR violation"
    expect(output).not.toContain("GDPR violation");
  });

  it("renders tracker-with-consent-component as ControlResult output without a ComplianceGap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tracker-with-consent-component"
    // And the fixture control result status is "PASS"
    // And the fixture evidence is "web/app/components/CookieBanner.tsx records analytics opt-in"
    const controlResult = mat114NonGapControlResult({
      fixture: "tracker-with-consent-component",
      control_id: "gdpr-eprivacy-consent-tracking",
      status: "PASS",
      evidence: "web/app/components/CookieBanner.tsx records analytics opt-in",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output shows ControlResult status "PASS"
    expect(output).toContain("ControlResult");
    expect(output).toContain("PASS");

    // And the rendered output shows evidence "web/app/components/CookieBanner.tsx records analytics opt-in"
    expect(output).toContain("web/app/components/CookieBanner.tsx records analytics opt-in");

    // And the rendered output does not create a ComplianceGap
    expect(output).not.toContain("ComplianceGap");
  });

  it("renders local-storage-language-only as ControlResult output without a ComplianceGap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "local-storage-language-only"
    // And the fixture control result status is "PASS"
    // And the fixture evidence is "web/app/i18n.ts stores language preference only"
    const controlResult = mat114NonGapControlResult({
      fixture: "local-storage-language-only",
      control_id: "gdpr-eprivacy-consent-tracking",
      status: "PASS",
      evidence: "web/app/i18n.ts stores language preference only",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output shows ControlResult status "PASS"
    expect(output).toContain("ControlResult");
    expect(output).toContain("PASS");

    // And the rendered output shows evidence "web/app/i18n.ts stores language preference only"
    expect(output).toContain("web/app/i18n.ts stores language preference only");

    // And the rendered output does not create a ComplianceGap
    expect(output).not.toContain("ComplianceGap");
  });

  it("renders no-tracker as ControlResult output without a ComplianceGap", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "no-tracker"
    // And the fixture control result status is "SKIPPED"
    // And the fixture evidence is "no tracker or storage signal found"
    const controlResult = mat114NonGapControlResult({
      fixture: "no-tracker",
      control_id: "gdpr-eprivacy-consent-tracking",
      status: "SKIPPED",
      evidence: "no tracker or storage signal found",
    });

    // When the control result is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the rendered output shows ControlResult status "SKIPPED"
    expect(output).toContain("ControlResult");
    expect(output).toContain("SKIPPED");

    // And the rendered output shows evidence "no tracker or storage signal found"
    expect(output).toContain("no tracker or storage signal found");

    // And the rendered output does not create a ComplianceGap
    expect(output).not.toContain("ComplianceGap");
  });

  it("renders the MAT-114 gap without forcing it through the legacy CWE-only renderer", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tracker-without-consent"
    // And the fixture produces ComplianceGap "gap-tracker-consent-010"
    // And the gap references control "gdpr-eprivacy-consent-tracking"
    // And the gap has no CWE
    const controlResult = mat114GapControlResult({
      fixture: "tracker-without-consent",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      consent_evidence:
        "no consent banner, CMP integration, delayed activation, privacy route, or exemption",
      gap_id: "gap-tracker-consent-010",
      status: "WARNING",
      severity: "major",
    });

    // When the output contract renders the fixture
    const output = expectString(
      callExport("renderControlResultOutput", controlResult, { catalog }),
    );

    // Then the contract fails if "gap-tracker-consent-010" is dropped because no CWE exists
    expect(output).toContain("gap-tracker-consent-010");

    // And the contract fails if "gap-tracker-consent-010" is rendered as a legacy Finding
    expect(output).not.toMatch(/\bFinding\b/u);
  });

  it("renders MAT-114 relation metadata in PR output for changed files", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And control "gdpr-eprivacy-consent-tracking" belongs to framework "GDPR/ePrivacy"
    // And control "gdpr-eprivacy-consent-tracking" has framework reference "GDPR Art. 5(1)(a)"
    // And control "gdpr-eprivacy-consent-tracking" has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And control "gdpr-eprivacy-consent-tracking" has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given the MAT-114 fixture "tracker-without-consent"
    // And the fixture produces ComplianceGap "gap-tracker-consent-011"
    // And "gap-tracker-consent-011" is linked to file "web/app/layout.tsx"
    // And the PR changes file "web/app/layout.tsx"
    const controlResult = mat114GapControlResult({
      fixture: "tracker-without-consent",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      consent_evidence:
        "no consent banner, CMP integration, delayed activation, privacy route, or exemption",
      gap_id: "gap-tracker-consent-011",
      status: "WARNING",
      severity: "major",
    });

    // When the PR output is rendered through the output contract
    const output = expectString(
      callExport("renderControlResultPullRequestOutput", controlResult, {
        catalog,
        changed_files: ["web/app/layout.tsx"],
        relations: [{ gap_id: "gap-tracker-consent-011", file: "web/app/layout.tsx" }],
      }),
    );

    // Then the PR output shows "gap-tracker-consent-011"
    expect(output).toContain("gap-tracker-consent-011");

    // And the PR output shows evidence "web/app/layout.tsx:12 imports @vercel/analytics/react"
    expect(output).toContain("web/app/layout.tsx:12 imports @vercel/analytics/react");
  });
});

function mat114GapControlResult(input: {
  readonly fixture: string;
  readonly control_id: string;
  readonly evidence: string;
  readonly consent_evidence: string;
  readonly gap_id: string;
  readonly status: string;
  readonly severity: string;
}): object {
  return {
    fixture: input.fixture,
    control_id: input.control_id,
    status: input.status,
    evidence: input.evidence,
    consent_evidence: input.consent_evidence,
    compliance_gap: {
      id: input.gap_id,
      control_id: input.control_id,
      status: input.status,
      severity: input.severity,
      evidence: input.evidence,
    },
  };
}

function mat114NonGapControlResult(input: {
  readonly fixture: string;
  readonly control_id: string;
  readonly status: string;
  readonly evidence: string;
}): object {
  return {
    fixture: input.fixture,
    control_id: input.control_id,
    status: input.status,
    evidence: input.evidence,
  };
}

function callExport(name: string, ...args: readonly unknown[]): unknown {
  const exported: unknown = Reflect.get(reviewEngine, name);
  expect(exported, `${name} export is missing`).toBeTypeOf("function");

  if (typeof exported !== "function") {
    throw new TypeError(`${name} export is not callable`);
  }

  return Reflect.apply(exported, undefined, args);
}

function expectString(value: unknown): string {
  expect(value).toEqual(expect.any(String));

  if (typeof value !== "string") {
    throw new TypeError("Expected a string");
  }

  return value;
}
