// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import * as reviewEngine from "./index.js";

const cataloguedControls = [
  {
    control_id: "gdpr-eprivacy-consent-tracking",
    framework_reference: "GDPR Art. 5(1)(a)",
    source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
    remediation_guidance: "Delay non-essential analytics until consent is recorded",
  },
  {
    control_id: "internal-critical-audit-logging",
    framework_reference: "Internal Audit Logging Control A-12",
    source_url: "catalog://internal/security-controls/a-12",
    remediation_guidance: "Record audit events for critical operations",
  },
] as const;

const projectGaps = [
  {
    id: "gap-tracker-consent-008",
    control_id: "gdpr-eprivacy-consent-tracking",
    evidence: "web/app/layout.tsx imports analytics before consent",
    status: "WARNING",
    severity: "major",
  },
  {
    id: "gap-audit-logging-001",
    control_id: "internal-critical-audit-logging",
    evidence: "api/audit/log.ts does not persist critical operation events",
    status: "WARNING",
    severity: "major",
  },
] as const;

describe("PR output filters gaps by change relation while reports show all gaps", () => {
  it("shows only gaps related to changed files in PR output", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the catalog contains control "internal-critical-audit-logging"
    // And control "internal-critical-audit-logging" has framework reference "Internal Audit Logging Control A-12"
    // And control "internal-critical-audit-logging" has source URL "catalog://internal/security-controls/a-12"
    // And control "internal-critical-audit-logging" has remediation guidance "Record audit events for critical operations"
    // And the project has ComplianceGap "gap-tracker-consent-008" for control "gdpr-eprivacy-consent-tracking"
    // And "gap-tracker-consent-008" is linked to file "web/app/layout.tsx"
    // And the project has ComplianceGap "gap-audit-logging-001" for control "internal-critical-audit-logging"
    // And "gap-audit-logging-001" is linked to file "api/audit/log.ts"
    // Given the PR changes file "web/app/layout.tsx"
    // And the PR does not change file "api/audit/log.ts"
    // When the PR output is rendered with relation metadata
    const output = expectString(
      callExport("renderComplianceGapPullRequestProjection", projectGaps, {
        catalog: cataloguedControls,
        changed_files: ["web/app/layout.tsx"],
        relations: [
          { gap_id: "gap-tracker-consent-008", file: "web/app/layout.tsx" },
          { gap_id: "gap-audit-logging-001", file: "api/audit/log.ts" },
        ],
      }),
    );

    // Then the PR output shows "gap-tracker-consent-008"
    expect(output).toContain("gap-tracker-consent-008");

    // And the PR output does not show "gap-audit-logging-001"
    expect(output).not.toContain("gap-audit-logging-001");
  });

  it("shows all project gaps in project report output", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the catalog contains control "internal-critical-audit-logging"
    // And control "internal-critical-audit-logging" has framework reference "Internal Audit Logging Control A-12"
    // And control "internal-critical-audit-logging" has source URL "catalog://internal/security-controls/a-12"
    // And control "internal-critical-audit-logging" has remediation guidance "Record audit events for critical operations"
    // And the project has ComplianceGap "gap-tracker-consent-008" for control "gdpr-eprivacy-consent-tracking"
    // And "gap-tracker-consent-008" is linked to file "web/app/layout.tsx"
    // And the project has ComplianceGap "gap-audit-logging-001" for control "internal-critical-audit-logging"
    // And "gap-audit-logging-001" is linked to file "api/audit/log.ts"
    // Given the project report is rendered outside a PR change filter
    // When the project report output is rendered
    const report = expectString(
      callExport("renderComplianceGapProjectReportProjection", projectGaps, {
        catalog: cataloguedControls,
      }),
    );

    // Then the project report shows "gap-tracker-consent-008"
    expect(report).toContain("gap-tracker-consent-008");

    // And the project report shows "gap-audit-logging-001"
    expect(report).toContain("gap-audit-logging-001");
  });

  it("omits project-level gaps from PR output when relation metadata is unavailable", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the catalog contains control "internal-critical-audit-logging"
    // And control "internal-critical-audit-logging" has framework reference "Internal Audit Logging Control A-12"
    // And control "internal-critical-audit-logging" has source URL "catalog://internal/security-controls/a-12"
    // And control "internal-critical-audit-logging" has remediation guidance "Record audit events for critical operations"
    // And the project has ComplianceGap "gap-tracker-consent-008" for control "gdpr-eprivacy-consent-tracking"
    // And "gap-tracker-consent-008" is linked to file "web/app/layout.tsx"
    // And the project has ComplianceGap "gap-audit-logging-001" for control "internal-critical-audit-logging"
    // And "gap-audit-logging-001" is linked to file "api/audit/log.ts"
    // Given the PR changes file "web/app/layout.tsx"
    // And relation metadata is unavailable for project compliance gaps
    // When the PR output is rendered
    const output = expectString(
      callExport("renderComplianceGapPullRequestProjection", projectGaps, {
        catalog: cataloguedControls,
        changed_files: ["web/app/layout.tsx"],
      }),
    );

    // Then the PR output does not show "gap-tracker-consent-008"
    expect(output).not.toContain("gap-tracker-consent-008");

    // And the PR output does not show "gap-audit-logging-001"
    expect(output).not.toContain("gap-audit-logging-001");

    // When internal compliance diagnostics are rendered
    const diagnostics = expectString(
      callExport("renderComplianceGapProjectionDiagnostics", projectGaps, {
        catalog: cataloguedControls,
        changed_files: ["web/app/layout.tsx"],
      }),
    );

    // Then the diagnostics show "relation metadata unavailable for PR compliance-gap projection"
    expect(diagnostics).toContain("relation metadata unavailable for PR compliance-gap projection");
  });

  it("fails the contract when PR output publishes unrelated gaps", () => {
    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the catalog contains control "internal-critical-audit-logging"
    // And control "internal-critical-audit-logging" has framework reference "Internal Audit Logging Control A-12"
    // And control "internal-critical-audit-logging" has source URL "catalog://internal/security-controls/a-12"
    // And control "internal-critical-audit-logging" has remediation guidance "Record audit events for critical operations"
    // And the project has ComplianceGap "gap-tracker-consent-008" for control "gdpr-eprivacy-consent-tracking"
    // And "gap-tracker-consent-008" is linked to file "web/app/layout.tsx"
    // And the project has ComplianceGap "gap-audit-logging-001" for control "internal-critical-audit-logging"
    // And "gap-audit-logging-001" is linked to file "api/audit/log.ts"
    // Given the PR changes file "web/app/layout.tsx"
    // And relation metadata links "gap-audit-logging-001" only to file "api/audit/log.ts"
    // When the PR output is rendered
    const evaluation = expectPlainObject(
      callExport("evaluateComplianceGapPullRequestProjection", projectGaps, {
        catalog: cataloguedControls,
        changed_files: ["web/app/layout.tsx"],
        relations: [{ gap_id: "gap-audit-logging-001", file: "api/audit/log.ts" }],
        pull_request_output: "potential compliance gap\ngap-audit-logging-001",
      }),
    );

    // Then the PR output fails the contract if it shows "gap-audit-logging-001"
    expect(Reflect.get(evaluation, "output_contract_check")).toBe("failed");
    expect(Reflect.get(evaluation, "rejected_gap_id")).toBe("gap-audit-logging-001");

    // And the failure explains that PR output is limited to change-related compliance gaps
    expect(Reflect.get(evaluation, "explanation")).toContain(
      "PR output is limited to change-related compliance gaps",
    );
  });

  it("uses the same PR filter for route and dependency relations", () => {
    const routeAndDependencyGaps = [
      {
        id: "gap-checkout-tracker-001",
        control_id: "gdpr-eprivacy-consent-tracking",
        evidence: "/checkout loads analytics before consent",
      },
      {
        id: "gap-analytics-sdk-001",
        control_id: "gdpr-eprivacy-consent-tracking",
        evidence: "analytics-js@2.4.0 starts before consent state is known",
      },
      {
        id: "gap-admin-retention-001",
        control_id: "internal-critical-audit-logging",
        evidence: "/admin/retention omits retention audit logging",
      },
    ] as const;

    // Given the catalog contains control "gdpr-eprivacy-consent-tracking"
    // And the catalog contains control "internal-critical-audit-logging"
    // And control "internal-critical-audit-logging" has framework reference "Internal Audit Logging Control A-12"
    // And control "internal-critical-audit-logging" has source URL "catalog://internal/security-controls/a-12"
    // And control "internal-critical-audit-logging" has remediation guidance "Record audit events for critical operations"
    // Given the PR changes route "/checkout"
    // And the PR changes dependency "analytics-js@2.4.0"
    // And ComplianceGap "gap-checkout-tracker-001" references control "gdpr-eprivacy-consent-tracking"
    // And ComplianceGap "gap-checkout-tracker-001" is linked to route "/checkout"
    // And ComplianceGap "gap-analytics-sdk-001" references control "gdpr-eprivacy-consent-tracking"
    // And ComplianceGap "gap-analytics-sdk-001" is linked to dependency "analytics-js@2.4.0"
    // And ComplianceGap "gap-admin-retention-001" references control "internal-critical-audit-logging"
    // And ComplianceGap "gap-admin-retention-001" is linked to route "/admin/retention"
    // When the PR output is rendered with relation metadata
    const output = expectString(
      callExport("renderComplianceGapPullRequestProjection", routeAndDependencyGaps, {
        catalog: cataloguedControls,
        changed_routes: ["/checkout"],
        changed_dependencies: ["analytics-js@2.4.0"],
        relations: [
          { gap_id: "gap-checkout-tracker-001", route: "/checkout" },
          { gap_id: "gap-analytics-sdk-001", dependency: "analytics-js@2.4.0" },
          { gap_id: "gap-admin-retention-001", route: "/admin/retention" },
        ],
      }),
    );

    // Then the PR output shows "gap-checkout-tracker-001"
    expect(output).toContain("gap-checkout-tracker-001");

    // And the PR output shows "gap-analytics-sdk-001"
    expect(output).toContain("gap-analytics-sdk-001");

    // And the PR output does not show "gap-admin-retention-001"
    expect(output).not.toContain("gap-admin-retention-001");
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
