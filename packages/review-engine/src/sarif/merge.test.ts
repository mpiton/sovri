// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-09 (merge, dedup, diff-scope and stable ordering of
// SARIF with LLM findings): SARIF is merged after the LLM findings, cross-source
// collisions collapse to the LLM finding, same-file non-overlapping stay
// distinct, cross-tool duplicates collapse first-wins, equal-severity mixed
// sources order by a stable tie-break, and SARIF surfaces only when its file is
// in the diff's changed-files set (off-hunk renders walkthrough-only).

import type { Diff, Finding, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildInlineComments } from "../walkthrough/inline.js";
import { mergeSarifFindings } from "./merge.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

type HunkSpec = { readonly start: number; readonly lines: number };

function makeDiff(files: ReadonlyArray<{ path: string; hunks: readonly HunkSpec[] }>): Diff {
  return {
    unified_diff: "diff --git",
    files: files.map((file) => ({
      path: file.path,
      status: "modified" as const,
      additions: 1,
      deletions: 0,
      sha: SHA,
      patch: null,
      hunks: file.hunks.map((hunk) => ({
        old_start: hunk.start,
        old_lines: 0,
        new_start: hunk.start,
        new_lines: hunk.lines,
        header: `@@ -${hunk.start},0 +${hunk.start},${hunk.lines} @@`,
        lines: Array.from({ length: hunk.lines }, (_, index) => `+code-${hunk.start + index}`),
      })),
    })),
  };
}

let idSeq = 0;
function makeFinding(
  overrides: Partial<Finding> & Pick<Finding, "file" | "line_start" | "line_end" | "source">,
): Finding {
  idSeq += 1;
  const suffix = String(idSeq).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    severity: "major",
    category: "security",
    title: "finding",
    body: "body",
    recommendation: "fix it",
    confidence: 0.9,
    compliance_references: [],
    ...overrides,
  };
}

const NO_THRESHOLD: Severity = "nitpick";

describe("mergeSarifFindings — R-09 merge, dedup, diff-scope, ordering", () => {
  it("collapses a cross-source collision to the LLM finding", () => {
    // Given an LLM finding and a SARIF finding on the same file, same CWE, overlapping lines
    const diff = makeDiff([{ path: "src/auth.ts", hunks: [{ start: 10, lines: 4 }] }]);
    const llm = makeFinding({
      source: "llm",
      file: "src/auth.ts",
      line_start: 10,
      line_end: 12,
      cwe: "CWE-89",
    });
    const sarif = makeFinding({
      source: "sarif",
      file: "src/auth.ts",
      line_start: 11,
      line_end: 13,
      cwe: "CWE-89",
    });

    // When merged / Then one finding remains and it is the LLM finding
    const merged = mergeSarifFindings([llm], [sarif], diff, NO_THRESHOLD, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("llm");
  });

  it("keeps same-file non-overlapping findings distinct", () => {
    // Given an LLM and a SARIF finding on the same file but non-overlapping lines
    const diff = makeDiff([
      {
        path: "src/auth.ts",
        hunks: [
          { start: 10, lines: 3 },
          { start: 40, lines: 3 },
        ],
      },
    ]);
    const llm = makeFinding({
      source: "llm",
      file: "src/auth.ts",
      line_start: 10,
      line_end: 12,
      cwe: "CWE-89",
    });
    const sarif = makeFinding({
      source: "sarif",
      file: "src/auth.ts",
      line_start: 40,
      line_end: 42,
      cwe: "CWE-89",
    });

    // When merged / Then both remain
    expect(mergeSarifFindings([llm], [sarif], diff, NO_THRESHOLD, [])).toHaveLength(2);
  });

  it("collapses cross-tool SARIF duplicates first-wins", () => {
    // Given a Semgrep and a Trivy SARIF finding on the same file, line, and CWE
    const diff = makeDiff([{ path: "src/db.ts", hunks: [{ start: 7, lines: 1 }] }]);
    const semgrep = makeFinding({
      source: "sarif",
      file: "src/db.ts",
      line_start: 7,
      line_end: 7,
      cwe: "CWE-89",
      title: "semgrep",
    });
    const trivy = makeFinding({
      source: "sarif",
      file: "src/db.ts",
      line_start: 7,
      line_end: 7,
      cwe: "CWE-89",
      title: "trivy",
    });

    // When merged / Then one SARIF finding remains, the one seen first
    const merged = mergeSarifFindings([], [semgrep, trivy], diff, NO_THRESHOLD, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("semgrep");
  });

  it("orders equal-severity mixed sources by a stable tie-break (LLM before SARIF)", () => {
    // Given an LLM and a SARIF finding of equal severity on the same line, no CWE
    const diff = makeDiff([{ path: "src/a.ts", hunks: [{ start: 5, lines: 1 }] }]);
    const llm = makeFinding({
      source: "llm",
      file: "src/a.ts",
      line_start: 5,
      line_end: 5,
      severity: "major",
    });
    const sarif = makeFinding({
      source: "sarif",
      file: "src/a.ts",
      line_start: 5,
      line_end: 5,
      severity: "major",
    });

    // When ordered / Then the LLM finding precedes the SARIF finding, repeatably
    const first = mergeSarifFindings([llm], [sarif], diff, NO_THRESHOLD, []);
    const second = mergeSarifFindings([llm], [sarif], diff, NO_THRESHOLD, []);
    expect(first.map((finding) => finding.source)).toEqual(["llm", "sarif"]);
    expect(second.map((finding) => finding.source)).toEqual(["llm", "sarif"]);
  });

  it("does not surface a SARIF finding on a file outside the diff", () => {
    // Given a SARIF finding on a file not in the diff changed-files set
    const diff = makeDiff([{ path: "src/auth.ts", hunks: [{ start: 10, lines: 2 }] }]);
    const sarif = makeFinding({
      source: "sarif",
      file: "src/legacy/untouched.ts",
      line_start: 3,
      line_end: 3,
    });

    // When merged / Then the SARIF finding is not surfaced
    expect(mergeSarifFindings([], [sarif], diff, NO_THRESHOLD, [])).toHaveLength(0);
  });

  it("surfaces a SARIF finding on a changed file off any hunk in the walkthrough only", () => {
    // Given a SARIF finding on a changed file but off every hunk
    const diff = makeDiff([{ path: "src/auth.ts", hunks: [{ start: 10, lines: 11 }] }]);
    const sarif = makeFinding({
      source: "sarif",
      file: "src/auth.ts",
      line_start: 200,
      line_end: 200,
    });

    // When merged / Then it surfaces in the walkthrough (merged set)
    const merged = mergeSarifFindings([], [sarif], diff, NO_THRESHOLD, []);
    expect(merged).toHaveLength(1);
    // And it produces no inline comment (off-hunk, not anchorable)
    expect(buildInlineComments(merged, diff)).toHaveLength(0);
  });

  it("filters a SARIF finding below the configured severity threshold", () => {
    // Given a severityThreshold of "minor" and a SARIF finding of severity "nitpick"
    const diff = makeDiff([{ path: "src/auth.ts", hunks: [{ start: 11, lines: 1 }] }]);
    const sarif = makeFinding({
      source: "sarif",
      file: "src/auth.ts",
      line_start: 11,
      line_end: 11,
      severity: "nitpick",
    });

    // When merged / Then it is filtered out
    expect(mergeSarifFindings([], [sarif], diff, "minor", [])).toHaveLength(0);
  });

  it("drops a SARIF finding on an ignored path", () => {
    // Given an ignore rule matching "src/generated/**" and a SARIF finding there
    const diff = makeDiff([{ path: "src/generated/client.ts", hunks: [{ start: 5, lines: 1 }] }]);
    const sarif = makeFinding({
      source: "sarif",
      file: "src/generated/client.ts",
      line_start: 5,
      line_end: 5,
      severity: "major",
    });

    // When merged / Then the ignore rule drops it
    expect(mergeSarifFindings([], [sarif], diff, NO_THRESHOLD, ["src/generated/**"])).toHaveLength(
      0,
    );
  });

  it("orders equal-severity same-source findings by file then line", () => {
    // Given three SARIF findings of equal severity on two changed files
    const diff = makeDiff([
      { path: "src/b.ts", hunks: [{ start: 1, lines: 5 }] },
      { path: "src/a.ts", hunks: [{ start: 1, lines: 5 }] },
    ]);
    const onB = makeFinding({ source: "sarif", file: "src/b.ts", line_start: 1, line_end: 1 });
    const onALate = makeFinding({ source: "sarif", file: "src/a.ts", line_start: 3, line_end: 3 });
    const onAEarly = makeFinding({ source: "sarif", file: "src/a.ts", line_start: 1, line_end: 1 });

    // When merged / Then they order by file then line
    const merged = mergeSarifFindings([], [onB, onALate, onAEarly], diff, NO_THRESHOLD, []);
    expect(merged.map((finding) => `${finding.file}:${finding.line_start}`)).toEqual([
      "src/a.ts:1",
      "src/a.ts:3",
      "src/b.ts:1",
    ]);
  });

  it("orders mixed severities by severity descending", () => {
    // Given a major and an info SARIF finding on the same changed file
    const diff = makeDiff([{ path: "src/a.ts", hunks: [{ start: 1, lines: 2 }] }]);
    const major = makeFinding({
      source: "sarif",
      file: "src/a.ts",
      line_start: 1,
      line_end: 1,
      severity: "major",
    });
    const info = makeFinding({
      source: "sarif",
      file: "src/a.ts",
      line_start: 2,
      line_end: 2,
      severity: "info",
    });

    // When merged in reverse / Then the more severe finding sorts first
    const merged = mergeSarifFindings([], [info, major], diff, NO_THRESHOLD, []);
    expect(merged.map((finding) => finding.severity)).toEqual(["major", "info"]);
  });

  it("breaks a full tie by id", () => {
    // Given two SARIF findings identical but for their id (no CWE, so no collapse)
    const diff = makeDiff([{ path: "src/a.ts", hunks: [{ start: 1, lines: 1 }] }]);
    const lower = makeFinding({
      source: "sarif",
      file: "src/a.ts",
      line_start: 1,
      line_end: 1,
      id: "00000000-0000-4000-8000-0000000000a1",
    });
    const higher = makeFinding({
      source: "sarif",
      file: "src/a.ts",
      line_start: 1,
      line_end: 1,
      id: "00000000-0000-4000-8000-0000000000b2",
    });

    // When merged in reverse / Then the lower id sorts first
    const merged = mergeSarifFindings([], [higher, lower], diff, NO_THRESHOLD, []);
    expect(merged.map((finding) => finding.id)).toEqual([lower.id, higher.id]);
  });
});
