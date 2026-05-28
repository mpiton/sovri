// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ComplianceReference, Finding } from "@sovri/core";

import { enrichFindingCompliance } from "./enricher.js";
import * as complianceRoot from "../index.js";

const baseFinding: Finding = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  severity: "major",
  category: "security",
  file: "src/auth/login.ts",
  line_start: 42,
  line_end: 44,
  title: "Hardcoded credential detected",
  body: "A credential literal is committed to source control.",
  source: "llm",
  confidence: 0.92,
  compliance_references: [],
};

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return { ...baseFinding, ...overrides };
}

const informationalRef: ComplianceReference = {
  framework: "GDPR",
  identifier: "Art. 5",
  description: "Principles relating to processing of personal data.",
  source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  applicability: "informational",
};

const secondInformationalRef: ComplianceReference = {
  framework: "ISO27001-2022",
  identifier: "A.5.1",
  description: "Policies for information security.",
  source_url: "https://www.iso.org/standard/27001",
  applicability: "informational",
};

describe("enrichFindingCompliance — lookup by CWE", () => {
  it("populates compliance references for a mapped CWE (R-05)", () => {
    const result = enrichFindingCompliance(makeFinding({ cwe: "CWE-798" }));

    expect(result.compliance_references).toHaveLength(6);
    expect(result.compliance_references).toContainEqual(
      expect.objectContaining({ framework: "GDPR", identifier: "Art. 32" }),
    );
    expect(result.compliance_references).toContainEqual(
      expect.objectContaining({ framework: "NIS2", identifier: "Art. 21(2)(i)" }),
    );
  });

  it.each([
    { cwe: "CWE-798", count: 6 },
    { cwe: "CWE-89", count: 2 },
  ])("maps $cwe to $count documented references (R-05)", ({ cwe, count }) => {
    expect(enrichFindingCompliance(makeFinding({ cwe })).compliance_references).toHaveLength(count);
  });

  it("returns no references when the CWE is absent from the map (R-04)", () => {
    expect(
      enrichFindingCompliance(makeFinding({ cwe: "CWE-9999" })).compliance_references,
    ).toHaveLength(0);
  });

  it("returns no references when the finding has no CWE (R-03)", () => {
    expect(enrichFindingCompliance(makeFinding()).compliance_references).toHaveLength(0);
  });

  it("is idempotent when re-enriching a mapped finding (overwrite from map)", () => {
    const once = enrichFindingCompliance(makeFinding({ cwe: "CWE-798" }));
    const twice = enrichFindingCompliance(once);

    expect(twice.compliance_references).toHaveLength(6);
    expect(twice).toEqual(once);
  });

  it("clears stale references when the CWE is unmapped (overwrite from map)", () => {
    const stale = makeFinding({
      cwe: "CWE-9999",
      compliance_references: [informationalRef, secondInformationalRef],
    });

    expect(enrichFindingCompliance(stale).compliance_references).toHaveLength(0);
  });
});

describe("enrichFindingCompliance — purity", () => {
  it("does not mutate the input finding (R-01)", () => {
    const finding = makeFinding({ cwe: "CWE-798" });

    enrichFindingCompliance(finding);

    expect(finding.compliance_references).toHaveLength(0);
  });

  it("returns a new object that preserves every unrelated field (R-06)", () => {
    const finding = makeFinding({ cwe: "CWE-798" });

    const result = enrichFindingCompliance(finding);

    expect(result).not.toBe(finding);
    expect(result.id).toBe(finding.id);
    expect(result.severity).toBe(finding.severity);
    expect(result.category).toBe(finding.category);
    expect(result.file).toBe(finding.file);
    expect(result.line_start).toBe(finding.line_start);
    expect(result.line_end).toBe(finding.line_end);
    expect(result.title).toBe(finding.title);
    expect(result.body).toBe(finding.body);
    expect(result.source).toBe(finding.source);
    expect(result.confidence).toBe(finding.confidence);
    expect(result.cwe).toBe(finding.cwe);
  });
});

describe("enrichFindingCompliance — no I/O", () => {
  const enricherSourcePath = fileURLToPath(new URL("./enricher.ts", import.meta.url));
  const forbiddenIoPatterns = ["import(", "fetch(", "node:fs", "readFileSync", "require("];

  it("contains no filesystem, network, or dynamic-import access in its source (R-02)", () => {
    const source = readFileSync(enricherSourcePath, "utf8");

    for (const pattern of forbiddenIoPatterns) {
      expect(source).not.toContain(pattern);
    }
  });

  it("returns synchronously rather than as a promise (R-02)", () => {
    const result = enrichFindingCompliance(makeFinding({ cwe: "CWE-798" }));

    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe("enrichFindingCompliance — public API", () => {
  it("is exported from the package root and callable (R-07)", () => {
    expect(typeof complianceRoot.enrichFindingCompliance).toBe("function");
    expect(
      complianceRoot.enrichFindingCompliance(makeFinding({ cwe: "CWE-798" })).compliance_references,
    ).toHaveLength(6);
  });
});
