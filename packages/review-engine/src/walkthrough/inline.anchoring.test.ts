// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildInlineComments } from "./inline.js";

const sha = "3".repeat(40);

describe("buildInlineComments diff anchoring", () => {
  it("converts a finding on an existing changed line", () => {
    // Given a parsed diff contains file "src/billing.ts" with RIGHT-side lines 30, 31, and 32
    const diff = createBillingDiff([30, 31, 32]);

    // And a finding targets file "src/billing.ts" from line 31 to line 31
    const findings = [createBillingFinding("src/billing.ts", 31)];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 1 inline comment draft is returned
    expect(comments).toHaveLength(1);
    const [draft] = comments;

    // And the draft path is "src/billing.ts"
    expect(draft?.path).toBe("src/billing.ts");
    // And the draft line is 31
    expect(draft?.line).toBe(31);
  });

  it("skips a finding on a missing file", () => {
    // Given a parsed diff contains file "src/billing.ts" with RIGHT-side line 31
    const diff = createBillingDiff([31]);

    // And a finding targets file "src/payments.ts" from line 31 to line 31
    const findings = [createBillingFinding("src/payments.ts", 31)];
    let comments: ReturnType<typeof buildInlineComments> = [];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const buildComments = () => {
      comments = buildInlineComments(findings, diff);
    };

    // Then exactly 0 inline comment drafts are returned
    // And no error is raised
    expect(buildComments).not.toThrow();
    expect(comments).toHaveLength(0);
  });

  it("skips a finding on a missing line", () => {
    // Given a parsed diff contains file "src/billing.ts" with RIGHT-side lines 30, 31, and 32
    const diff = createBillingDiff([30, 31, 32]);

    // And a finding targets file "src/billing.ts" from line 99 to line 99
    const findings = [createBillingFinding("src/billing.ts", 99)];
    let comments: ReturnType<typeof buildInlineComments> = [];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const buildComments = () => {
      comments = buildInlineComments(findings, diff);
    };

    // Then exactly 0 inline comment drafts are returned
    // And no error is raised
    expect(buildComments).not.toThrow();
    expect(comments).toHaveLength(0);
  });

  it("skips a multi-line finding unless every line in the range exists", () => {
    // Given a parsed diff contains file "src/billing.ts" with RIGHT-side lines 30 and 32
    // And RIGHT-side line 31 is absent from the parsed diff
    const diff = createBillingDiff([30, 32]);

    // And a finding targets file "src/billing.ts" from line 30 to line 32
    const findings = [createBillingFinding("src/billing.ts", 30, 32)];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 0 inline comment drafts are returned
    expect(comments).toHaveLength(0);
    // And no partial multi-line draft is returned
    expect(comments).toEqual([]);
  });
});

function createBillingDiff(rightSideLines: readonly number[]): Diff {
  const hunks = rightSideLines.map((line) => ({
    old_start: line,
    old_lines: 0,
    new_start: line,
    new_lines: 1,
    header: `@@ -${line},0 +${line},1 @@`,
    lines: [`+line${line}();`],
  }));
  const patch = [
    "diff --git a/src/billing.ts b/src/billing.ts",
    `index ${"0".repeat(40)}..${sha} 100644`,
    "--- a/src/billing.ts",
    "+++ b/src/billing.ts",
    ...hunks.flatMap((hunk) => [hunk.header, ...hunk.lines]),
  ].join("\n");

  return {
    unified_diff: patch,
    files: [
      {
        path: "src/billing.ts",
        status: "modified",
        additions: rightSideLines.length,
        deletions: 0,
        sha,
        patch,
        hunks,
      },
    ],
  };
}

function createBillingFinding(file: string, lineStart: number, lineEnd = lineStart): Finding {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    severity: "major",
    category: "security",
    file,
    line_start: lineStart,
    line_end: lineEnd,
    title: "Missing billing guard",
    body: "This billing path can be reached without verifying payment state.",
    recommendation: "Add a payment state check before proceeding with the billing operation.",
    source: "llm",
    confidence: 0.9,
  };
}
