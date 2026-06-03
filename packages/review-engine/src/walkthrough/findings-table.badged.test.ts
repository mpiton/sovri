// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-05 — the Findings section is a single severity-badged table: one row per finding, the
// Severity column rendered with the task-117 brand glyph (emoji, never a CSS class), rows kept in
// the existing sortFindings order (severity rank descending, then file/line).

type Spec = {
  readonly severity: Severity;
  readonly file: string;
  readonly line: number;
  readonly title: string;
};

let seq = 0;
function makeFinding(spec: Spec): Finding {
  seq += 1;
  const hex = seq.toString(16).padStart(12, "0");
  return {
    id: `44444444-4444-4444-8444-${hex}`,
    severity: spec.severity,
    category: "bug",
    file: spec.file,
    line_start: spec.line,
    line_end: spec.line,
    title: spec.title,
    body: `Body for ${spec.title}.`,
    source: "llm",
    confidence: 0.8,
  };
}

const baseReview: Omit<Review, "findings"> = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "Badged findings table.",
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

function findingsSection(markdown: string): string {
  const start = markdown.indexOf("### Findings");
  const end = markdown.indexOf("### File-by-file");
  return markdown.slice(start, end < 0 ? undefined : end);
}

function findingsRows(markdown: string): string[][] {
  const tableLines = findingsSection(markdown)
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"));
  // tableLines[0] = header, tableLines[1] = separator, the rest are data rows.
  return tableLines.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
}

function reviewOf(specs: readonly Spec[]): Review {
  return { ...baseReview, findings: specs.map(makeFinding) };
}

describe("walkthrough findings table — badged severity (R-05)", () => {
  it("renders one badged row per finding in a single table", () => {
    // Given a review with a blocker "SQL injection" and a minor "Unused import"
    const review = reviewOf([
      { severity: "blocker", file: "src/a.ts", line: 5, title: "SQL injection" },
      { severity: "minor", file: "src/a.ts", line: 40, title: "Unused import" },
    ]);

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the Findings section is a single table with exactly 2 rows (no per-severity subheadings)
    expect(findingsSection(markdown)).not.toContain("#### ");
    const rows = findingsRows(markdown);
    expect(rows).toHaveLength(2);

    // And the Severity cell for "SQL injection" shows "⛔"
    const sqlRow = rows.find((row) => row.some((cell) => cell.includes("SQL injection")));
    expect(sqlRow?.[0]).toBe("⛔");
    // And the Severity cell for "Unused import" shows "🟡"
    const unusedRow = rows.find((row) => row.some((cell) => cell.includes("Unused import")));
    expect(unusedRow?.[0]).toBe("🟡");
    // And no Severity cell contains a CSS "class=" attribute
    for (const row of rows) {
      expect(row[0]).not.toContain("class=");
    }
  });

  it("orders rows by severity rank then file and line", () => {
    // Given findings: minor b.ts:10 "B-low", blocker a.ts:5 "A-top", major a.ts:20 "A-mid"
    const review = reviewOf([
      { severity: "minor", file: "src/b.ts", line: 10, title: "B-low" },
      { severity: "blocker", file: "src/a.ts", line: 5, title: "A-top" },
      { severity: "major", file: "src/a.ts", line: 20, title: "A-mid" },
    ]);

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the Findings table rows appear in order A-top, A-mid, B-low
    const titles = findingsRows(markdown).map((row) => row[2]);
    expect(titles).toEqual(["A-top", "A-mid", "B-low"]);
  });
});
