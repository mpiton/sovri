// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildInlineComments } from "./inline.js";

const sha = "1".repeat(40);

describe("buildInlineComments line mapping", () => {
  it("maps a single-line finding to line without start range fields", () => {
    // Given a parsed diff contains file "src/config.ts" with RIGHT-side line 12
    const diff = createConfigDiff(12, ["export const timeoutMs = 1000;"]);

    // And a finding targets file "src/config.ts" from line 12 to line 12
    const findings = [createConfigFinding(12, 12)];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 1 inline comment draft is returned
    expect(comments).toHaveLength(1);
    // And the draft line is 12
    expect(comments[0]?.line).toBe(12);
    // And the draft side is "RIGHT"
    expect(comments[0]?.side).toBe("RIGHT");
    // And the draft does not contain `start_line`
    expect(comments[0]).not.toHaveProperty("start_line");
    // And the draft does not contain `start_side`
    expect(comments[0]).not.toHaveProperty("start_side");
  });

  it("maps a multi-line finding to start_line and line", () => {
    // Given a parsed diff contains file "src/config.ts" with RIGHT-side lines 12, 13, and 14
    const diff = createConfigDiff(12, [
      "export const timeoutMs = 1000;",
      "export const retryCount = 3;",
      "export const backoffMs = 50;",
    ]);

    // And a finding targets file "src/config.ts" from line 12 to line 14
    const findings = [createConfigFinding(12, 14)];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 1 inline comment draft is returned
    expect(comments).toHaveLength(1);
    // And the draft start_line is 12
    expect(comments[0]?.start_line).toBe(12);
    // And the draft start_side is "RIGHT"
    expect(comments[0]?.start_side).toBe("RIGHT");
    // And the draft line is 14
    expect(comments[0]?.line).toBe(14);
    // And the draft side is "RIGHT"
    expect(comments[0]?.side).toBe("RIGHT");
  });

  it("treats a two-line range as a multi-line comment", () => {
    // Given a parsed diff contains file "src/config.ts" with RIGHT-side lines 20 and 21
    const diff = createConfigDiff(20, [
      "export const enableReviews = true;",
      "export const maxFindings = 25;",
    ]);

    // And a finding targets file "src/config.ts" from line 20 to line 21
    const findings = [createConfigFinding(20, 21)];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 1 inline comment draft is returned
    expect(comments).toHaveLength(1);
    // And the draft start_line is 20
    expect(comments[0]?.start_line).toBe(20);
    // And the draft line is 21
    expect(comments[0]?.line).toBe(21);
    // And the draft start_side is "RIGHT"
    expect(comments[0]?.start_side).toBe("RIGHT");
    // And the draft side is "RIGHT"
    expect(comments[0]?.side).toBe("RIGHT");
  });

  it("rejects a reversed finding range before mapping", () => {
    // Given a finding targets file "src/config.ts" from line 14 to line 12
    const findings = [createConfigFinding(14, 12)];

    // And the parsed diff contains file "src/config.ts" with RIGHT-side lines 12, 13, and 14
    const diff = createConfigDiff(12, [
      "export const timeoutMs = 1000;",
      "export const retryCount = 3;",
      "export const backoffMs = 50;",
    ]);

    let comments: ReturnType<typeof buildInlineComments> | undefined;

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const build = () => {
      comments = buildInlineComments(findings, diff);
    };

    // Then validation fails for the finding range
    expect(build).toThrow();
    // And no inline comment draft is returned for that finding
    expect(comments).toBeUndefined();
  });
});

function createConfigDiff(newStart: number, addedLines: readonly string[]): Diff {
  const hunkLines = addedLines.map((line) => `+${line}`);
  const header = `@@ -${newStart},0 +${newStart},${addedLines.length} @@`;
  const patch = [
    "diff --git a/src/config.ts b/src/config.ts",
    `index ${"0".repeat(40)}..${sha} 100644`,
    "--- a/src/config.ts",
    "+++ b/src/config.ts",
    header,
    ...hunkLines,
  ].join("\n");

  return {
    unified_diff: patch,
    files: [
      {
        path: "src/config.ts",
        status: "modified",
        additions: addedLines.length,
        deletions: 0,
        sha,
        patch,
        hunks: [
          {
            old_start: newStart,
            old_lines: 0,
            new_start: newStart,
            new_lines: addedLines.length,
            header,
            lines: hunkLines,
          },
        ],
      },
    ],
  };
}

function createConfigFinding(lineStart: number, lineEnd: number): Finding {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    severity: "major",
    category: "bug",
    file: "src/config.ts",
    line_start: lineStart,
    line_end: lineEnd,
    title: "Unsafe config read",
    body: "The config value is read before validation.",
    source: "llm",
    confidence: 0.87,
  };
}
