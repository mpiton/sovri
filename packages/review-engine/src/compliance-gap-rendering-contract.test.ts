// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import * as reviewEngine from "./index.js";

const cataloguedControl = {
  control_id: "gdpr-eprivacy-consent-tracking",
  framework_reference: "GDPR Art. 5(1)(a)",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
  remediation_guidance: "Delay non-essential analytics until consent is recorded",
} as const;
const catalog = [cataloguedControl];

describe("Catalogued control references render without a CWE", () => {
  it("renders a catalogued reference in project report output without a CWE", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the control has framework reference "GDPR Art. 5(1)(a)"
    // And the control has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And the control has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given a ComplianceGap "gap-tracker-consent-004"
    // And the gap references control "gdpr-eprivacy-consent-tracking"
    // And the gap has evidence "web/app/layout.tsx:12 imports @vercel/analytics/react"
    // And the gap has status "WARNING"
    // And the gap has severity "major"
    // And the gap has no CWE
    const gap = {
      id: "gap-tracker-consent-004",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
      status: "WARNING",
      severity: "major",
    };

    // When the project report output is rendered
    const report = expectString(
      callExport("renderComplianceGapProjectReportOutput", gap, { catalog }),
    );

    // Then the report shows "potential compliance gap"
    expect(report).toContain("potential compliance gap");

    // And the report shows framework reference "GDPR Art. 5(1)(a)"
    expect(report).toContain("GDPR Art. 5(1)(a)");

    // And the report shows source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    expect(report).toContain("https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng");

    // And the report shows control id "gdpr-eprivacy-consent-tracking"
    expect(report).toContain("gdpr-eprivacy-consent-tracking");

    // And the report does not show a CWE requirement for the gap
    expect(report).not.toMatch(/\bCWE\b/u);
  });

  it("renders a catalogued reference in PR output without a CWE when related to the change", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the control has framework reference "GDPR Art. 5(1)(a)"
    // And the control has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And the control has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given a changed file "web/app/layout.tsx"
    // And a ComplianceGap "gap-tracker-consent-005" references control "gdpr-eprivacy-consent-tracking"
    // And the gap relation metadata links it to file "web/app/layout.tsx"
    // And the gap has no CWE
    const gap = {
      id: "gap-tracker-consent-005",
      control_id: "gdpr-eprivacy-consent-tracking",
      evidence: "web/app/layout.tsx:12 imports @vercel/analytics/react",
    };

    // When the PR output is rendered
    const output = expectString(
      callExport("renderComplianceGapPullRequestOutput", gap, {
        catalog,
        changed_files: ["web/app/layout.tsx"],
        relations: [{ gap_id: "gap-tracker-consent-005", file: "web/app/layout.tsx" }],
      }),
    );

    // Then the PR output shows "potential compliance gap"
    expect(output).toContain("potential compliance gap");

    // And the PR output shows framework reference "GDPR Art. 5(1)(a)"
    expect(output).toContain("GDPR Art. 5(1)(a)");

    // And the PR output shows evidence "web/app/layout.tsx:12 imports @vercel/analytics/react"
    expect(output).toContain("web/app/layout.tsx:12 imports @vercel/analytics/react");
  });

  it("fails the output contract check when a legacy renderer requires a CWE", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the control has framework reference "GDPR Art. 5(1)(a)"
    // And the control has source URL "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng"
    // And the control has remediation guidance "Delay non-essential analytics until consent is recorded"
    // Given a ComplianceGap "gap-tracker-consent-006" references control "gdpr-eprivacy-consent-tracking"
    // And the catalog has framework reference "GDPR Art. 5(1)(a)" for the control
    // And the gap has no CWE
    // And the renderer incorrectly requires every compliance item to have a CWE
    const gap = {
      id: "gap-tracker-consent-006",
      control_id: "gdpr-eprivacy-consent-tracking",
    };

    // When the renderer evaluates whether the gap can be published
    const evaluation = expectPlainObject(
      callExport("evaluateComplianceGapPublishability", gap, {
        catalog,
        renderer_requires_cwe: true,
      }),
    );

    // Then the renderer rejects "gap-tracker-consent-006" because the CWE is absent
    expect(Reflect.get(evaluation, "publishable")).toBe(false);
    expect(Reflect.get(evaluation, "rejected_gap_id")).toBe("gap-tracker-consent-006");
    expect(Reflect.get(evaluation, "reason")).toBe("CWE is absent");

    // And the output contract check fails
    expect(Reflect.get(evaluation, "output_contract_check")).toBe("failed");

    // And the failure explains that catalogued control references can render without a CWE
    expect(Reflect.get(evaluation, "explanation")).toContain(
      "catalogued control references can render without a CWE",
    );
  });
});

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

function expectPlainObject(value: unknown): object {
  expect(value).toEqual(expect.any(Object));

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a plain object");
  }

  return value;
}
