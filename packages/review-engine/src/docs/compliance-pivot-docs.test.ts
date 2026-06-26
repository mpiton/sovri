// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));
const projectRoot = dirname(dirname(adrDocsRoot));
const pivotAdrPath = join(adrDocsRoot, "022-project-level-compliance-pivot-vocabulary.md");

// These literals are the MAT-80 acceptance contract, not reusable product configuration.
const requiredDefinitions = [
  {
    term: "ComplianceGap",
    meaning: "project-level compliance output for an unmet control or missing evidence",
  },
  {
    term: "ControlResult",
    meaning: "result of evaluating a control against its rules and collected evidence",
  },
  {
    term: "Control",
    meaning: "framework requirement that the project must satisfy",
  },
  {
    term: "Rule",
    meaning: "technical verification attached to a control",
  },
  {
    term: "Evidence",
    meaning: "collected proof or observation used to support a control result or compliance gap",
  },
  {
    term: "FrameworkReference",
    meaning: "versioned framework citation with official text or source URL from a catalog",
  },
] as const;
const requiredProjectLevelTerms = ["ComplianceGap", "ControlResult"] as const;
const modelSplitDocPaths = ["PRD.md", "ARCHI.md", "CONTEXT.md"] as const;
const modelSplitStatements = {
  sourceModel: "project compliance scans evaluate Framework -> Control -> Rule -> Evidence",
  complianceGapOutput: "project compliance scan produces ComplianceGap output",
  prProjection: "PR review may project relevant compliance gaps into pull request output",
} as const;
const complianceGapFindingCategoryMisuse = {
  term: "ComplianceGap",
  statement: "ComplianceGap is a Finding category emitted by PR review",
  explanation: "ComplianceGap must be project-level compliance output",
  pattern: /\bComplianceGap\b\s+is\s+a\s+Finding\s+category\b(?:\s+emitted\s+by\s+PR\s+review\b)?/i,
} as const;

function findAdrDocsRoot(startDir: string): string {
  let currentDir = startDir;

  for (;;) {
    const candidate = join(currentDir, "docs", "adr");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not locate docs/adr from compliance pivot docs test");
    }
    currentDir = parentDir;
  }
}

function readDocs(): string {
  return readdirSync(adrDocsRoot)
    .filter((docPath) => docPath.endsWith(".md"))
    .map((docPath) => readFileSync(join(adrDocsRoot, docPath), "utf8"))
    .join("\n");
}

function readPivotAdr(): string {
  return readFileSync(pivotAdrPath, "utf8");
}

function readProjectDoc(docPath: string): string {
  return readFileSync(join(projectRoot, docPath), "utf8");
}

function findDefinitionLines(docs: string, term: string): string[] {
  const definitionMarker = `**${term.toLowerCase()}**`;
  return docs.split(/\r?\n/).filter((line) => line.toLowerCase().includes(definitionMarker));
}

function missingRequiredDefinitionTerms(_docs: string): string[] {
  return requiredProjectLevelTerms.filter((term) => findDefinitionLines(_docs, term).length === 0);
}

function findingCategoryFailureMessages(_docs: string): string[] {
  return _docs
    .split(/\r?\n/)
    .filter((line) => complianceGapFindingCategoryMisuse.pattern.test(line))
    .map(() => complianceGapFindingCategoryMisuse.explanation);
}

describe("MAT-80 compliance pivot vocabulary docs", () => {
  it("defines each required project-level compliance term explicitly", () => {
    // When the compliance vocabulary is reviewed
    const docs = readDocs();
    const pivotAdr = readPivotAdr();

    expect(pivotAdr).toContain("# ADR-022 - Project-level compliance pivot vocabulary");
    expect(pivotAdr).toContain("**Status:** Accepted");
    expect(pivotAdr).toContain("## Context");
    expect(pivotAdr).toContain("## Decision");
    expect(pivotAdr).toContain("## Consequences");
    expect(
      findingCategoryFailureMessages(docs),
      `${complianceGapFindingCategoryMisuse.term} must not be documented as a Finding category`,
    ).toEqual([]);

    const requiredTermKeys = requiredDefinitions.map(({ term }) => term.toLowerCase());
    expect(
      new Set(requiredTermKeys).size,
      "required definitions must not contain case-insensitive duplicate terms",
    ).toBe(requiredDefinitions.length);

    for (const { term, meaning } of requiredDefinitions) {
      const definitionLines = findDefinitionLines(docs, term);

      expect(
        definitionLines,
        `${term} must have exactly one case-insensitive definition`,
      ).toHaveLength(1);

      const definitionText = definitionLines[0] ?? "";
      const normalizedDefinitionText = definitionText.toLowerCase();

      // Then the term "<term>" is defined with the meaning "<meaning>"
      expect(definitionText, `${term} must be defined with meaning: ${meaning}`).toContain(meaning);

      // And the definition does not describe "<term>" as an enum-only review category
      expect(normalizedDefinitionText).not.toContain("enum-only review category");
      expect(normalizedDefinitionText).not.toContain("finding category");
      expect(normalizedDefinitionText).not.toContain("category emitted by pr review");
    }
  });

  it("fails the vocabulary check when project-level vocabulary is missing", () => {
    // Given "CONTEXT.md" defines "Finding" as a diff/code issue
    const docs = ["# CONTEXT.md", "**Finding** - diff/code issue"].join("\n");

    // And the documentation set has no definition for "ComplianceGap"
    expect(docs).not.toMatch(/\*\*ComplianceGap\*\*/i);

    // And the documentation set has no definition for "ControlResult"
    expect(docs).not.toMatch(/\*\*ControlResult\*\*/i);

    // When the compliance vocabulary is reviewed
    const missingTerms = missingRequiredDefinitionTerms(docs);

    // Then the vocabulary check fails
    expect(missingTerms.length).toBeGreaterThan(0);

    // And the missing terms are "ComplianceGap, ControlResult"
    expect(missingTerms.join(", ")).toBe(requiredProjectLevelTerms.join(", "));
  });

  it("fails when ComplianceGap is documented as a Finding category", () => {
    // Given "ARCHI.md" says "ComplianceGap is a Finding category emitted by PR review"
    const docs = ["# ARCHI.md", complianceGapFindingCategoryMisuse.statement].join("\n");

    // When the compliance vocabulary is reviewed
    const failureMessages = findingCategoryFailureMessages(docs);

    // Then the vocabulary check fails
    expect(failureMessages.length).toBeGreaterThan(0);

    // And the failure explains that "ComplianceGap" must be project-level compliance output
    expect(failureMessages.join("\n")).toContain(complianceGapFindingCategoryMisuse.explanation);
  });

  it.each(modelSplitDocPaths)("names the source model and PR projection in %s", (docPath) => {
    // Given "<doc_path>" is part of the compliance pivot documentation set
    const docs = readProjectDoc(docPath);

    // When the compliance model documentation is reviewed

    // Then "<doc_path>" states that project compliance scans evaluate "Framework -> Control -> Rule -> Evidence"
    expect(
      docs.includes(modelSplitStatements.sourceModel),
      `${docPath} must name the project compliance source model`,
    ).toBe(true);

    // And "<doc_path>" states that the project compliance scan produces "ComplianceGap" output
    expect(
      docs.includes(modelSplitStatements.complianceGapOutput),
      `${docPath} must name ComplianceGap as project compliance scan output`,
    ).toBe(true);

    // And "<doc_path>" states that PR review may project relevant compliance gaps into pull request output
    expect(
      docs.includes(modelSplitStatements.prProjection),
      `${docPath} must name the PR review projection`,
    ).toBe(true);
  });
});
