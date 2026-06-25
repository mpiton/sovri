// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// Rule: R-01 — a still-valid finding already posted is not posted again, and
// duplicates produced within one run are collapsed.
// Mirrors specs/bug-1965-rereview-finding-dedup/r-01-no-duplicate-still-valid.feature

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { computeFindingFingerprint } from "./fingerprint.js";
import { reconcileFindings } from "./reconcile.js";

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

describe("reconcileFindings", () => {
  it("drops a finding whose fingerprint is already posted", () => {
    // Given the bot already posted a finding for the SQL injection in
    //   "src/db/query.ts" over source text "db.query(userInput)"
    const postedDiff = makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]);
    const posted = makeFinding({
      file: "src/db/query.ts",
      line_start: 42,
      line_end: 42,
      category: "security",
      cwe: "CWE-89",
      title: "SQL injection risk",
      body: "User input flows into the query unescaped.",
    });
    const postedFingerprints = new Set([computeFindingFingerprint(posted, postedDiff)]);

    // And the new review run re-produces that finding with shifted lines and a
    //   reworded title (same source text)
    const reproducedDiff = makeDiff("src/db/query.ts", 50, ["db.query(userInput)"]);
    const reproduced = makeFinding({
      file: "src/db/query.ts",
      line_start: 50,
      line_end: 50,
      category: "security",
      cwe: "CWE-89",
      title: "Possible SQLi",
      body: "Unescaped user input reaches the query.",
    });

    // When the bot reconciles the new findings against the posted fingerprints
    const kept = reconcileFindings([reproduced], reproducedDiff, postedFingerprints);

    // Then that finding is not kept to post
    expect(kept).toHaveLength(0);
  });

  it("keeps a new finding and drops the already-posted one", () => {
    const diff: Diff = {
      unified_diff: "diff --git a/src/db/query.ts b/src/db/query.ts",
      files: [
        ...makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]).files,
        ...makeDiff("src/api/handler.ts", 8, ["await next()"]).files,
      ],
    };
    const alreadyPosted = makeFinding({
      file: "src/db/query.ts",
      line_start: 42,
      line_end: 42,
      category: "security",
      cwe: "CWE-89",
      title: "SQL injection risk",
      body: "User input flows into the query unescaped.",
    });
    const fresh = makeFinding({
      file: "src/api/handler.ts",
      line_start: 8,
      line_end: 8,
      category: "bug",
      title: "Unhandled rejection",
      body: "The awaited call can reject without a handler.",
    });
    const postedFingerprints = new Set([computeFindingFingerprint(alreadyPosted, diff)]);

    const kept = reconcileFindings([alreadyPosted, fresh], diff, postedFingerprints);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.file).toBe("src/api/handler.ts");
  });

  it("keeps only one of two findings that resolve to the same fingerprint", () => {
    // Given the new review run produces two findings that resolve to the same
    //   fingerprint (same file, category, CWE and source text)
    const diff = makeDiff("src/util/parse.ts", 10, ["value.split(',')"]);
    const first = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "bug",
      title: "Brittle parser",
      body: "splits on comma without quoting",
    });
    const second = makeFinding({
      file: "src/util/parse.ts",
      line_start: 10,
      line_end: 10,
      category: "bug",
      title: "Fragile CSV split",
      body: "splits on comma without quoting",
    });

    // When the bot reconciles against an empty set of posted fingerprints
    const kept = reconcileFindings([first, second], diff, new Set());

    // Then exactly one of them is kept to post
    expect(kept).toHaveLength(1);
  });

  it("reconciles an empty findings list to an empty result", () => {
    // Given the new review run produces no findings
    const diff = makeDiff("src/db/query.ts", 42, ["db.query(userInput)"]);

    // When the bot reconciles the new findings against the posted fingerprints
    const kept = reconcileFindings([], diff, new Set(["deadbeefdeadbeef"]));

    // Then no findings are kept to post (and reconciliation does not raise)
    expect(kept).toHaveLength(0);
  });
});
