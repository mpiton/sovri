// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import {
  CategorySchema,
  COMPLIANCE_MIN_CONFIDENCE,
  type ComplianceReference,
  type Finding,
} from "@sovri/core";
import { describe, expect, it } from "vitest";

import { partitionComplianceMappedFindings, shouldEnrichCompliance } from "./compliance-gate.js";
import type { ProviderFinding } from "./parsing/index.js";

function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return {
    severity: "major",
    category: "security",
    file: "src/app.ts",
    line_start: 1,
    line_end: 1,
    title: "t",
    body: "b",
    recommendation: "r",
    confidence: 1,
    cwe: "CWE-89",
    ...overrides,
  } as ProviderFinding;
}

const mappedReference: ComplianceReference = {
  framework: "CWE",
  identifier: "CWE-89",
  description: "SQL Injection",
  source_url: "https://cwe.mitre.org/data/definitions/89.html",
  applicability: "informational",
};

function coreFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    audit_reference: "SOVRI-SC-ABCD-1234",
    severity: "major",
    category: "security",
    file: "src/app.ts",
    line_start: 1,
    line_end: 1,
    title: "t",
    body: "b",
    recommendation: "r",
    source: "llm",
    confidence: 0.9,
    compliance_references: [],
    ...overrides,
  };
}

describe("shouldEnrichCompliance", () => {
  it("pins the threshold at 0.7", () => {
    expect(COMPLIANCE_MIN_CONFIDENCE).toBe(0.7);
  });

  it("enriches a security finding with a CWE at the threshold", () => {
    expect(shouldEnrichCompliance(finding({ confidence: 0.7 }))).toBe(true);
  });

  it("enriches a bug finding with a CWE", () => {
    expect(shouldEnrichCompliance(finding({ category: "bug" }))).toBe(true);
  });

  it("skips when confidence is below the threshold", () => {
    expect(shouldEnrichCompliance(finding({ confidence: 0.69 }))).toBe(false);
  });

  it("treats every current category as eligible since the taxonomy is the compliance set (ADR-021)", () => {
    // After the compliance pivot the Category enum is exactly the eligible set, so the allowlist
    // admits all of it; it remains as defense-in-depth if a non-compliance category is reintroduced.
    for (const category of CategorySchema.options) {
      expect(shouldEnrichCompliance(finding({ category }))).toBe(true);
    }
  });

  it("admits an eligible finding with no CWE so the enricher can derive one (ADR-020)", () => {
    expect(shouldEnrichCompliance(finding({ cwe: undefined }))).toBe(true);
  });
});

describe("partitionComplianceMappedFindings", () => {
  it("keeps a finding that carries at least one compliance reference", () => {
    const mapped = coreFinding({ compliance_references: [mappedReference] });

    const { kept, droppedCount } = partitionComplianceMappedFindings([mapped]);

    expect(kept).toEqual([mapped]);
    expect(droppedCount).toBe(0);
  });

  it("drops a finding whose compliance_references is empty", () => {
    const { kept, droppedCount } = partitionComplianceMappedFindings([coreFinding()]);

    expect(kept).toEqual([]);
    expect(droppedCount).toBe(1);
  });

  it("keeps only the mapped findings in a mixed batch and counts the rest", () => {
    const mapped = coreFinding({ compliance_references: [mappedReference] });
    const unmapped = coreFinding({ category: "bug" });

    const { kept, droppedCount } = partitionComplianceMappedFindings([mapped, unmapped]);

    expect(kept).toEqual([mapped]);
    expect(droppedCount).toBe(1);
  });

  it("preserves the audit_reference on a retained finding", () => {
    const mapped = coreFinding({
      audit_reference: "SOVRI-SC-DEAD-BEEF",
      compliance_references: [mappedReference],
    });

    const { kept } = partitionComplianceMappedFindings([mapped]);

    expect(kept[0]?.audit_reference).toBe("SOVRI-SC-DEAD-BEEF");
  });

  it("returns an empty result for an empty input", () => {
    expect(partitionComplianceMappedFindings([])).toEqual({ kept: [], droppedCount: 0 });
  });
});
