// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Rule: R-03 — finding identity is stable and content-derived across runs.
// Acceptance scenarios mirrored from
// specs/bug-1965-rereview-finding-dedup/r-03-stable-identity.feature

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { computeFindingFingerprint } from "./fingerprint.js";

const SHA = "1".repeat(40);

function makeDiff(path: string, startLine: number, sourceLines: readonly string[]): Diff {
  return {
    unified_diff: `diff --git a/${path} b/${path}`,
    files: [
      {
        path,
        status: "modified",
        additions: sourceLines.length,
        deletions: 0,
        sha: SHA,
        patch: null,
        hunks: [
          {
            old_start: startLine,
            old_lines: 0,
            new_start: startLine,
            new_lines: sourceLines.length,
            header: `@@ -${startLine},0 +${startLine},${sourceLines.length} @@`,
            lines: sourceLines.map((line) => `+${line}`),
          },
        ],
      },
    ],
  };
}

function makeFinding(
  overrides: Partial<Finding> &
    Pick<Finding, "file" | "line_start" | "line_end" | "category" | "title" | "body">,
): Finding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    severity: "major",
    source: "llm",
    confidence: 0.9,
    ...overrides,
  };
}

describe("computeFindingFingerprint", () => {
  it("returns the same fingerprint when only the lines shift and the title is reworded (CWE present)", () => {
    // Given a finding on "src/db/query.ts" lines 42-44 with category "security",
    //   cwe "CWE-89" and title "SQL injection risk"
    const first = makeFinding({
      file: "src/db/query.ts",
      line_start: 42,
      line_end: 44,
      category: "security",
      cwe: "CWE-89",
      title: "SQL injection risk",
      body: "User input flows into the query unescaped.",
    });
    const firstDiff = makeDiff("src/db/query.ts", 42, [
      "db.query(userInput)",
      "// row read",
      "return row;",
    ]);
    // And a later finding on "src/db/query.ts" lines 50-52 with category "security",
    //   cwe "CWE-89" and title "Possible SQLi"
    const later = makeFinding({
      file: "src/db/query.ts",
      line_start: 50,
      line_end: 52,
      category: "security",
      cwe: "CWE-89",
      title: "Possible SQLi",
      body: "User input flows into the query unescaped.",
    });
    const laterDiff = makeDiff("src/db/query.ts", 50, [
      "db.query(userInput)",
      "// row read",
      "return row;",
    ]);

    // When the bot computes the fingerprint of each finding
    const firstFp = computeFindingFingerprint(first, firstDiff);
    const laterFp = computeFindingFingerprint(later, laterDiff);

    // Then both fingerprints are equal
    expect(firstFp).toBe(laterFp);
  });

  it.each([
    {
      changed: 'file ("src/db/other.ts")',
      variant: makeFinding({
        file: "src/db/other.ts",
        line_start: 42,
        line_end: 42,
        category: "security",
        title: "SQL injection risk",
        body: "User input flows into the query unescaped.",
      }),
      variantDiff: makeDiff("src/db/other.ts", 42, ["db.query(userInput)"]),
    },
    {
      changed: 'category ("maintainability")',
      variant: makeFinding({
        file: "src/db/query.ts",
        line_start: 42,
        line_end: 42,
        category: "maintainability",
        title: "SQL injection risk",
        body: "User input flows into the query unescaped.",
      }),
      variantDiff: makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]),
    },
    {
      changed: 'source text ("db.query(escape(userInput))")',
      variant: makeFinding({
        file: "src/db/query.ts",
        line_start: 42,
        line_end: 42,
        category: "security",
        title: "SQL injection risk",
        body: "User input flows into the query unescaped.",
      }),
      variantDiff: makeDiff("src/db/query.ts", 42, ["db.query(escape(userInput))"]),
    },
  ])(
    "returns a different fingerprint when only $changed changes (no CWE)",
    ({ variant, variantDiff }) => {
      // Given a baseline finding on "src/db/query.ts" line 42 with category
      //   "security", no cwe, over source text "db.query(userInput)"
      const baseline = makeFinding({
        file: "src/db/query.ts",
        line_start: 42,
        line_end: 42,
        category: "security",
        title: "SQL injection risk",
        body: "User input flows into the query unescaped.",
      });
      const baselineDiff = makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]);

      // When the bot computes the fingerprint of each finding
      const baselineFp = computeFindingFingerprint(baseline, baselineDiff);
      const variantFp = computeFindingFingerprint(variant, variantDiff);

      // Then the two fingerprints are different
      expect(baselineFp).not.toBe(variantFp);
    },
  );

  it("gives two distinct same-file same-CWE findings different fingerprints when the code differs", () => {
    // Given a finding on "src/db/query.ts" line 42 with category "security",
    //   cwe "CWE-89", over source text "db.query(userInput)"
    const first = makeFinding({
      file: "src/db/query.ts",
      line_start: 42,
      line_end: 42,
      category: "security",
      cwe: "CWE-89",
      title: "SQL injection risk",
      body: "User input flows into the query unescaped.",
    });
    const firstDiff = makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]);
    // And another finding on "src/db/query.ts" line 88 with category "security",
    //   cwe "CWE-89", over source text "db.exec(otherInput)"
    const second = makeFinding({
      file: "src/db/query.ts",
      line_start: 88,
      line_end: 88,
      category: "security",
      cwe: "CWE-89",
      title: "SQL injection risk",
      body: "User input flows into the query unescaped.",
    });
    const secondDiff = makeDiff("src/db/query.ts", 88, ["db.exec(otherInput)"]);

    // When the bot computes the fingerprint of each finding
    const firstFp = computeFindingFingerprint(first, firstDiff);
    const secondFp = computeFindingFingerprint(second, secondDiff);

    // Then the two fingerprints are different
    expect(firstFp).not.toBe(secondFp);
  });

  it("anchors on the source/body, not the title, when no CWE is present", () => {
    // Given a finding on "src/util/parse.ts" line 10 with no cwe,
    //   title "Brittle parser", body "splits on comma without quoting"
    //   over source text "value.split(',')"
    const parseDiff = makeDiff("src/util/parse.ts", 10, ["value.split(',')"]);
    const first = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "maintainability",
      title: "Brittle parser",
      body: "splits on comma without quoting",
    });
    // And a later finding on "src/util/parse.ts" line 10 with no cwe,
    //   title "Fragile CSV split", body "splits on comma without quoting"
    //   over source text "value.split(',')"
    const later = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "maintainability",
      title: "Fragile CSV split",
      body: "splits on comma without quoting",
    });

    // When the bot computes the fingerprint of each finding
    const firstFp = computeFindingFingerprint(first, parseDiff);
    const laterFp = computeFindingFingerprint(later, parseDiff);

    // Then both fingerprints are equal
    expect(firstFp).toBe(laterFp);
  });

  it("treats source code differing only by case as a different finding", () => {
    // Given a finding over source text "value.split(',')"
    const lower = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "maintainability",
      title: "Parser",
      body: "splits on comma without quoting",
    });
    const lowerDiff = makeDiff("src/util/parse.ts", 10, ["value.split(',')"]);
    // And a finding over source text "Value.Split(',')" (only the case differs)
    const cased = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "maintainability",
      title: "Parser",
      body: "splits on comma without quoting",
    });
    const casedDiff = makeDiff("src/util/parse.ts", 10, ["Value.Split(',')"]);

    // When the bot computes the fingerprint of each finding
    const lowerFp = computeFindingFingerprint(lower, lowerDiff);
    const casedFp = computeFindingFingerprint(cased, casedDiff);

    // Then the two fingerprints are different (code identity is case-sensitive)
    expect(lowerFp).not.toBe(casedFp);
  });

  it("falls back to a stable 16-char hex fingerprint when the anchor normalizes to empty", () => {
    // Given a finding on "src/util/blank.ts" line 1 with no cwe,
    //   body "trailing whitespace only line"
    //   over source text that normalizes to an empty string
    const blankDiff = makeDiff("src/util/blank.ts", 1, ["   "]);
    const finding = makeFinding({
      file: "src/util/blank.ts",
      line_start: 1,
      line_end: 1,
      category: "style",
      title: "Whitespace",
      body: "trailing whitespace only line",
    });

    // When the bot computes the fingerprint of the finding twice
    const firstFp = computeFindingFingerprint(finding, blankDiff);
    const secondFp = computeFindingFingerprint(finding, blankDiff);

    // Then the fingerprint is a 16-character lowercase hex value
    expect(firstFp).toMatch(/^[0-9a-f]{16}$/);
    // And both computations return the same fingerprint
    expect(firstFp).toBe(secondFp);
  });
});
