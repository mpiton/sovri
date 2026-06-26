// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const adrDocsRoot = findAdrDocsRoot(dirname(fileURLToPath(import.meta.url)));
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

function findDefinitionLines(docs: string, term: string): string[] {
  const definitionMarker = `**${term.toLowerCase()}**`;
  return docs.split(/\r?\n/).filter((line) => line.toLowerCase().includes(definitionMarker));
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
});
