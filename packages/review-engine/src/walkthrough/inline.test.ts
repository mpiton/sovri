// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildInlineComments } from "./inline.js";

const sha = "1".repeat(40);

function makeDiff(path: string, lines: readonly number[]): Diff {
  return {
    unified_diff: `diff --git a/${path} b/${path}`,
    files: [
      {
        path,
        status: "modified",
        additions: lines.length,
        deletions: 0,
        sha,
        patch: null,
        hunks: lines.map((line) => ({
          old_start: line,
          old_lines: 0,
          new_start: line,
          new_lines: 1,
          header: `@@ -${line},0 +${line},1 @@`,
          lines: ["+// changed"],
        })),
      },
    ],
  };
}

describe("buildInlineComments", () => {
  it("converts valid findings into inline comment drafts", () => {
    // Given a parsed diff contains file "src/session.ts" with RIGHT-side lines 18 and 19
    const diff: Diff = {
      unified_diff: [
        "diff --git a/src/session.ts b/src/session.ts",
        `index ${"0".repeat(40)}..${sha} 100644`,
        "--- a/src/session.ts",
        "+++ b/src/session.ts",
        "@@ -18,0 +18,2 @@",
        "+const userId = session.user.id;",
        "+throw new Error('session failed');",
      ].join("\n"),
      files: [
        {
          path: "src/session.ts",
          status: "modified",
          additions: 2,
          deletions: 0,
          sha,
          patch: [
            "diff --git a/src/session.ts b/src/session.ts",
            `index ${"0".repeat(40)}..${sha} 100644`,
            "--- a/src/session.ts",
            "+++ b/src/session.ts",
            "@@ -18,0 +18,2 @@",
            "+const userId = session.user.id;",
            "+throw new Error('session failed');",
          ].join("\n"),
          hunks: [
            {
              old_start: 18,
              old_lines: 0,
              new_start: 18,
              new_lines: 2,
              header: "@@ -18,0 +18,2 @@",
              lines: ["+const userId = session.user.id;", "+throw new Error('session failed');"],
            },
          ],
        },
      ],
    };

    // And the findings list contains:
    //   | file           | line_start | line_end | title              | body                                  |
    //   | src/session.ts | 18         | 18       | Missing null guard | `session.user` can be undefined.      |
    //   | src/session.ts | 19         | 19       | Weak error message | The thrown error hides useful context. |
    const findings: Finding[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        severity: "major",
        category: "bug",
        file: "src/session.ts",
        line_start: 18,
        line_end: 18,
        title: "Missing null guard",
        body: "`session.user` can be undefined.",
        source: "llm",
        confidence: 0.87,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        severity: "minor",
        category: "maintainability",
        file: "src/session.ts",
        line_start: 19,
        line_end: 19,
        title: "Weak error message",
        body: "The thrown error hides useful context.",
        source: "llm",
        confidence: 0.72,
      },
    ];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 2 inline comment drafts are returned
    expect(comments).toHaveLength(2);
    // And the first draft path is "src/session.ts"
    expect(comments[0]?.path).toBe("src/session.ts");
    // And the first draft line is 18
    expect(comments[0]?.line).toBe(18);
    // And the second draft path is "src/session.ts"
    expect(comments[1]?.path).toBe("src/session.ts");
    // And the second draft line is 19
    expect(comments[1]?.line).toBe(19);
  });

  it("does not produce partial drafts for invalid finding input", () => {
    // Given the findings list contains a finding with an empty file path
    const findings: Finding[] = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        severity: "major",
        category: "bug",
        file: "",
        line_start: 18,
        line_end: 18,
        title: "Missing null guard",
        body: "`session.user` can be undefined.",
        source: "llm",
        confidence: 0.87,
      },
    ];

    // And the parsed diff contains file "src/session.ts" with RIGHT-side line 18
    const diff: Diff = {
      unified_diff: [
        "diff --git a/src/session.ts b/src/session.ts",
        `index ${"0".repeat(40)}..${sha} 100644`,
        "--- a/src/session.ts",
        "+++ b/src/session.ts",
        "@@ -18,0 +18,1 @@",
        "+const userId = session.user.id;",
      ].join("\n"),
      files: [
        {
          path: "src/session.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          sha,
          patch: [
            "diff --git a/src/session.ts b/src/session.ts",
            `index ${"0".repeat(40)}..${sha} 100644`,
            "--- a/src/session.ts",
            "+++ b/src/session.ts",
            "@@ -18,0 +18,1 @@",
            "+const userId = session.user.id;",
          ].join("\n"),
          hunks: [
            {
              old_start: 18,
              old_lines: 0,
              new_start: 18,
              new_lines: 1,
              header: "@@ -18,0 +18,1 @@",
              lines: ["+const userId = session.user.id;"],
            },
          ],
        },
      ],
    };

    let comments: ReturnType<typeof buildInlineComments> | undefined;

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const build = () => {
      comments = buildInlineComments(findings, diff);
    };

    // Then validation fails against `FindingSchema`
    expect(build).toThrow();
    // And no partial inline comment drafts are returned
    expect(comments).toBeUndefined();
  });

  it("returns an empty draft list for empty finding input", () => {
    // Given the findings list is empty
    const findings: Finding[] = [];

    // And the parsed diff contains file "src/session.ts" with RIGHT-side line 18
    const diff: Diff = {
      unified_diff: [
        "diff --git a/src/session.ts b/src/session.ts",
        `index ${"0".repeat(40)}..${sha} 100644`,
        "--- a/src/session.ts",
        "+++ b/src/session.ts",
        "@@ -18,0 +18,1 @@",
        "+const userId = session.user.id;",
      ].join("\n"),
      files: [
        {
          path: "src/session.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          sha,
          patch: [
            "diff --git a/src/session.ts b/src/session.ts",
            `index ${"0".repeat(40)}..${sha} 100644`,
            "--- a/src/session.ts",
            "+++ b/src/session.ts",
            "@@ -18,0 +18,1 @@",
            "+const userId = session.user.id;",
          ].join("\n"),
          hunks: [
            {
              old_start: 18,
              old_lines: 0,
              new_start: 18,
              new_lines: 1,
              header: "@@ -18,0 +18,1 @@",
              lines: ["+const userId = session.user.id;"],
            },
          ],
        },
      ],
    };

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 0 inline comment drafts are returned
    expect(comments).toHaveLength(0);
    // And no error is raised
    expect(comments).toEqual([]);
  });
});

describe("buildInlineComments — audit reference line (R-01, R-02, R-03, R-04)", () => {
  it("renders the audit reference line just before the hidden finding marker", () => {
    // Given a finding "Missing null guard" in "src/session.ts" at line 18
    // And the finding body is "`session.user` can be undefined."
    // And the finding has audit reference "SOVRI-SC-AB12-CD34"
    const findings: Finding[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        audit_reference: "SOVRI-SC-AB12-CD34",
        severity: "major",
        category: "bug",
        file: "src/session.ts",
        line_start: 18,
        line_end: 18,
        title: "Missing null guard",
        body: "`session.user` can be undefined.",
        source: "llm",
        confidence: 0.87,
      },
    ];
    // And the diff anchors right-side line 18 of "src/session.ts"
    const diff = makeDiff("src/session.ts", [18]);

    // When the inline comments are built
    const comments = buildInlineComments(findings, diff);

    // Then exactly one inline comment is produced for "src/session.ts"
    expect(comments).toHaveLength(1);
    expect(comments[0]?.path).toBe("src/session.ts");
    // And the inline comment body renders the title, body and audit reference,
    // then the hidden finding marker as the very last line — enforced as a
    // single start-to-end match so nothing can be inserted before the marker
    expect(comments[0]?.body).toMatch(
      /^\*\*Missing null guard\*\*\n\n`session\.user` can be undefined\.\n\n🔍 Audit Reference: SOVRI-SC-AB12-CD34\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u,
    );
  });

  it("omits the audit reference line when the finding has no audit reference", () => {
    // Given a finding "Missing null guard" in "src/session.ts" at line 18
    // And the finding body is "`session.user` can be undefined."
    // And the finding has no audit reference
    const findings: Finding[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        severity: "major",
        category: "bug",
        file: "src/session.ts",
        line_start: 18,
        line_end: 18,
        title: "Missing null guard",
        body: "`session.user` can be undefined.",
        source: "llm",
        confidence: 0.87,
      },
    ];
    // And the diff anchors right-side line 18 of "src/session.ts"
    const diff = makeDiff("src/session.ts", [18]);

    // When the inline comments are built
    const comments = buildInlineComments(findings, diff);

    // Then the inline comment body does not contain "🔍 Audit Reference:"
    expect(comments[0]?.body).not.toContain("🔍 Audit Reference:");
    // And the inline comment body renders the title and body, then the hidden
    // finding marker as the very last line — single start-to-end match
    expect(comments[0]?.body).toMatch(
      /^\*\*Missing null guard\*\*\n\n`session\.user` can be undefined\.\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u,
    );
  });

  it("carries only the audit reference, never the compliance references block", () => {
    // Given a finding "Hardcoded credentials detected" in "src/db.ts" at line 42
    // And the finding body is "Credentials must not be committed to source control."
    // And the finding has audit reference "SOVRI-SC-AB12-CD34"
    // And the finding has these compliance references (GDPR Art. 32, DORA Art. 9)
    const findings: Finding[] = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        audit_reference: "SOVRI-SC-AB12-CD34",
        severity: "blocker",
        category: "security",
        file: "src/db.ts",
        line_start: 42,
        line_end: 42,
        title: "Hardcoded credentials detected",
        body: "Credentials must not be committed to source control.",
        source: "llm",
        confidence: 0.95,
        compliance_references: [
          {
            framework: "GDPR",
            identifier: "Art. 32",
            description: "Security of processing",
            source_url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
            applicability: "applicable_if",
            condition: "system processes personal data",
          },
          {
            framework: "DORA",
            identifier: "Art. 9",
            description: "ICT risk management",
            source_url: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
            applicability: "applicable_if",
            condition: "financial entity ICT infrastructure",
          },
        ],
      },
    ];
    // And the diff anchors right-side line 42 of "src/db.ts"
    const diff = makeDiff("src/db.ts", [42]);

    // When the inline comments are built
    const comments = buildInlineComments(findings, diff);

    // Then the inline comment body contains "🔍 Audit Reference: SOVRI-SC-AB12-CD34"
    expect(comments[0]?.body).toContain("🔍 Audit Reference: SOVRI-SC-AB12-CD34");
    // And the inline comment body does not contain "📋 Potential compliance references"
    expect(comments[0]?.body).not.toContain("📋 Potential compliance references");
    // And the inline comment body does not contain "GDPR: Art. 32"
    expect(comments[0]?.body).not.toContain("GDPR: Art. 32");
  });

  it("appends each finding's own audit reference to its own inline comment", () => {
    // Given the diff anchors right-side line 18 and line 42 of "src/session.ts"
    const diff = makeDiff("src/session.ts", [18, 42]);
    // And the findings:
    //   | file           | line | title                      | audit_reference    |
    //   | src/session.ts | 18   | Unvalidated session token  | SOVRI-SC-AB12-CD34 |
    //   | src/session.ts | 42   | Missing payload null guard | SOVRI-BU-1A2B-3C4D |
    const findings: Finding[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        audit_reference: "SOVRI-SC-AB12-CD34",
        severity: "major",
        category: "security",
        file: "src/session.ts",
        line_start: 18,
        line_end: 18,
        title: "Unvalidated session token",
        body: "The token is trusted unchecked.",
        source: "llm",
        confidence: 0.9,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        audit_reference: "SOVRI-BU-1A2B-3C4D",
        severity: "major",
        category: "bug",
        file: "src/session.ts",
        line_start: 42,
        line_end: 42,
        title: "Missing payload null guard",
        body: "The payload can be null here.",
        source: "llm",
        confidence: 0.8,
      },
    ];

    // When the inline comments are built
    const comments = buildInlineComments(findings, diff);

    // Then the inline comment for "src/session.ts" at line 18 carries
    // "🔍 Audit Reference: SOVRI-SC-AB12-CD34" just before its finding marker
    const at18 = comments.find((comment) => comment.line === 18);
    expect(at18?.body).toContain(
      "\n\n🔍 Audit Reference: SOVRI-SC-AB12-CD34\n\n<!-- sovri-finding-id: ",
    );
    expect(at18?.body).toMatch(/\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u);
    // And the inline comment for "src/session.ts" at line 42 carries
    // "🔍 Audit Reference: SOVRI-BU-1A2B-3C4D" just before its finding marker
    const at42 = comments.find((comment) => comment.line === 42);
    expect(at42?.body).toContain(
      "\n\n🔍 Audit Reference: SOVRI-BU-1A2B-3C4D\n\n<!-- sovri-finding-id: ",
    );
    expect(at42?.body).toMatch(/\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u);
  });
});
