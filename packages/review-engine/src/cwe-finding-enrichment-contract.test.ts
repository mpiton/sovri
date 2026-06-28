// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { enrichFindingCompliance } from "@sovri/compliance";
import type { Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as reviewEngine from "./index.js";

const cwe89Reference = "GDPR Art. 32";
const cataloguedControl = {
  control_id: "gdpr-eprivacy-consent-tracking",
  framework_reference: "GDPR Art. 5(1)(a)",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
  remediation_guidance: "Delay non-essential analytics until consent is recorded",
} as const;

describe("Security and bug findings keep the CWE enrichment path", () => {
  it.each(["security", "bug"] as const)(
    "keeps CWE-backed %s findings on the existing Finding enrichment path",
    (category) => {
      // Given the CWE compliance mapping contains "CWE-89"
      // And "CWE-89" maps to framework reference "GDPR Art. 32"
      // Given a Finding "finding-sql-injection-001"
      // And the finding category is "<category>"
      // And the finding CWE is "CWE-89"
      // And the finding confidence is 0.9
      // And the finding evidence is "src/db/users.ts:27 concatenates req.query.email into SQL"
      const finding = findingFor({
        id: "finding-sql-injection-001",
        category,
        cwe: "CWE-89",
        confidence: 0.9,
        body: "src/db/users.ts:27 concatenates req.query.email into SQL",
      });

      // When the existing Finding enrichment path runs
      const enrichedFinding = enrichFindingCompliance(finding);

      // Then the enriched Finding keeps CWE "CWE-89"
      expect(enrichedFinding.cwe).toBe("CWE-89");

      // And the enriched Finding renders framework reference "GDPR Art. 32"
      expect(renderComplianceReferenceLabels(enrichedFinding)).toContain(cwe89Reference);

      // And the enriched Finding is not converted into a ComplianceGap
      expect(Reflect.has(enrichedFinding, "control_id")).toBe(false);
    },
  );

  it("fails the output contract when a Finding loses CWE enrichment or renders only as a ComplianceGap", () => {
    // Given the CWE compliance mapping contains "CWE-89"
    // And "CWE-89" maps to framework reference "GDPR Art. 32"
    // Given a Finding "finding-sql-injection-002"
    // And the finding category is "security"
    // And the finding CWE is "CWE-89"
    // And the finding confidence is 0.9
    const finding = findingFor({
      id: "finding-sql-injection-002",
      category: "security",
      cwe: "CWE-89",
      confidence: 0.9,
    });

    // When the output contract renders the review
    const lostCweEvaluation = expectPlainObject(
      callExport("evaluateFindingOutputContract", finding, {
        rendered_finding: { ...finding, cwe: undefined },
      }),
    );
    const complianceGapOnlyEvaluation = expectPlainObject(
      callExport("evaluateFindingOutputContract", finding, {
        rendered_finding: {
          id: "finding-sql-injection-002",
          kind: "ComplianceGap",
          control_id: "gdpr-eprivacy-consent-tracking",
        },
      }),
    );

    // Then the review fails the contract if "finding-sql-injection-002" loses CWE "CWE-89"
    expect(Reflect.get(lostCweEvaluation, "output_contract_check")).toBe("failed");

    // And the review fails the contract if "finding-sql-injection-002" is rendered only as a ComplianceGap
    expect(Reflect.get(complianceGapOnlyEvaluation, "output_contract_check")).toBe("failed");
  });

  it("keeps CWE Findings and non-CWE ComplianceGaps on separate reference paths in a combined model", () => {
    // Given the CWE compliance mapping contains "CWE-89"
    // And "CWE-89" maps to framework reference "GDPR Art. 32"
    // Given a Finding "finding-sql-injection-003" with CWE "CWE-89"
    // And a ComplianceGap "gap-tracker-consent-007" with control id "gdpr-eprivacy-consent-tracking"
    // And "gap-tracker-consent-007" has no CWE
    const finding = findingFor({
      id: "finding-sql-injection-003",
      category: "security",
      cwe: "CWE-89",
    });
    const complianceGap = {
      id: "gap-tracker-consent-007",
      control_id: "gdpr-eprivacy-consent-tracking",
    };

    // When the combined review output model is built
    const combinedModel = expectPlainObject(
      callExport("buildCombinedReviewOutputModel", {
        findings: [finding],
        compliance_gaps: [complianceGap],
        catalog: [cataloguedControl],
      }),
    );

    // Then "finding-sql-injection-003" uses the Finding enrichment path
    expect(pathFor(combinedModel, "finding-sql-injection-003")).toBe("Finding enrichment path");

    // And "gap-tracker-consent-007" uses the ComplianceGap output contract
    expect(pathFor(combinedModel, "gap-tracker-consent-007")).toBe("ComplianceGap output contract");

    // And neither object changes the other object's compliance reference path
    expect(labelsFor(combinedModel, "finding-sql-injection-003")).toContain(cwe89Reference);
    expect(labelsFor(combinedModel, "gap-tracker-consent-007")).toContain("GDPR Art. 5(1)(a)");
    expect(labelsFor(combinedModel, "gap-tracker-consent-007")).not.toContain("CWE-89");
  });
});

function findingFor(overrides: Partial<Finding>): Finding {
  return {
    id: "finding-sql-injection-001",
    audit_reference: "SOVRI-SC-ABCD-1234",
    severity: "major",
    category: "security",
    file: "src/db/users.ts",
    line_start: 27,
    line_end: 27,
    title: "SQL injection risk",
    body: "src/db/users.ts:27 concatenates req.query.email into SQL",
    recommendation: "Use parameterized SQL queries.",
    source: "llm",
    confidence: 0.9,
    cwe: "CWE-89",
    compliance_references: [],
    ...overrides,
  };
}

function renderComplianceReferenceLabels(finding: Finding): readonly string[] {
  return finding.compliance_references.map((reference) =>
    [reference.framework, reference.identifier].join(" "),
  );
}

function callExport(name: string, ...args: readonly unknown[]): unknown {
  const exported: unknown = Reflect.get(reviewEngine, name);
  expect(exported, `${name} export is missing`).toBeTypeOf("function");

  if (typeof exported !== "function") {
    throw new TypeError(`${name} export is not callable`);
  }

  return Reflect.apply(exported, undefined, args);
}

function expectPlainObject(value: unknown): object {
  expect(value).toEqual(expect.any(Object));

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a plain object");
  }

  return value;
}

function pathFor(model: object, id: string): unknown {
  return Reflect.get(itemFor(model, id), "path");
}

function labelsFor(model: object, id: string): readonly unknown[] {
  const labels = Reflect.get(itemFor(model, id), "reference_labels");
  expect(labels).toEqual(expect.any(Array));

  if (!Array.isArray(labels)) {
    throw new TypeError("Expected reference_labels array");
  }

  return labels;
}

function itemFor(model: object, id: string): object {
  const items = Reflect.get(model, "items");
  expect(items).toEqual(expect.any(Array));

  if (!Array.isArray(items)) {
    throw new TypeError("Expected model items array");
  }

  const item = items.find((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }

    return Reflect.get(candidate, "id") === id;
  });
  expect(item, `${id} is missing from the combined model`).toEqual(expect.any(Object));

  if (typeof item !== "object" || item === null) {
    throw new TypeError("Expected model item object");
  }

  return item;
}
