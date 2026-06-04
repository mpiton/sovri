// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { categoryBadge, severityBadge } from "./badge.js";
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

describe("buildInlineComments — refreshed inline finding header", () => {
  it("starts every inline finding with the shared severity and category badges", () => {
    // Given the finding targets "src/session.ts" at line 18
    // And the finding title is "Missing null guard"
    // And the finding body is "`session.user` can be undefined."
    // And the finding severity is "major"
    // And the finding category is "bug"
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
    const diff = makeDiff("src/session.ts", [18]);

    // When Sovri formats the inline comment body
    const comments = buildInlineComments(findings, diff);
    const lines = comments[0]?.body.split("\n") ?? [];

    // Then line 1 is exactly the shared severity badge followed by the shared category badge
    expect(lines[0]).toBe(`${severityBadge("major")} ${categoryBadge("bug")}`);
    // And the old title-first shape is no longer used
    expect(lines[0]).not.toBe("**Missing null guard**");
    // And the bold title appears after the badge prefix
    expect(lines[1]).toBe("**Missing null guard**");
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
    // And the inline comment body renders the badge prefix, title, body and
    // audit reference, then the hidden finding marker as the very last line —
    // enforced as a single start-to-end match so nothing can be inserted before
    // the marker
    expect(comments[0]?.body).toMatch(
      /^🔴 🐛 Bug\n\*\*Missing null guard\*\*\n\n`session\.user` can be undefined\.\n\n🔍 Audit Reference: SOVRI-SC-AB12-CD34\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u,
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
    // And the inline comment body renders the badge prefix, title and body, then
    // the hidden finding marker as the very last line — single start-to-end match
    expect(comments[0]?.body).toMatch(
      /^🔴 🐛 Bug\n\*\*Missing null guard\*\*\n\n`session\.user` can be undefined\.\n\n<!-- sovri-finding-id: [0-9a-f]{16} -->$/u,
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

describe("buildInlineComments — committable suggestion blocks", () => {
  it("renders committable suggestion code exactly inside a GitHub suggestion fence", () => {
    // Given a finding targets "src/totals.ts" from line 14 to line 14
    // And the finding suggestion.code is "const total = amount ?? 0;"
    // And suggestion.committable is true
    const findings: Finding[] = [
      makeFinding({
        file: "src/totals.ts",
        lineStart: 14,
        title: "Use an explicit fallback",
        body: "The total can be undefined before formatting.",
        suggestion: { code: "const total = amount ?? 0;", committable: true },
      }),
    ];
    const diff = makeDiff("src/totals.ts", [14]);

    // When Sovri formats the inline comment body
    const comments = buildInlineComments(findings, diff);

    // Then the inline body contains a fenced "suggestion" block
    // And the suggestion block content is exactly "const total = amount ?? 0;"
    expect(comments[0]?.body).toContain(
      ["```suggestion", "const total = amount ?? 0;", "```"].join("\n"),
    );
  });

  it("uses a longer suggestion fence when the replacement code contains backticks", () => {
    // Given the finding suggestion.code contains a triple-backtick run
    // And suggestion.committable is true
    const findings: Finding[] = [
      makeFinding({
        file: "src/markdown.ts",
        lineStart: 8,
        title: "Escape markdown fence",
        body: "The replacement code embeds a markdown fence literal.",
        suggestion: { code: 'const fence = "```";', committable: true },
      }),
    ];
    const diff = makeDiff("src/markdown.ts", [8]);

    // When Sovri formats the inline comment body
    const comments = buildInlineComments(findings, diff);

    // Then the inline body uses a four-backtick suggestion fence
    // And the replacement code stays inside the suggestion block
    expect(comments[0]?.body).toContain(
      ["````suggestion", 'const fence = "```";', "````"].join("\n"),
    );
  });

  it("does not render a suggestion fence for absent or non-committable suggestions", () => {
    // Given one finding has no suggestion
    // And another finding has suggestion.committable false
    const findings: Finding[] = [
      makeFinding({
        file: "src/user.ts",
        lineStart: 22,
        title: "Guard missing user name",
        body: "The code assumes the user name is always present.",
      }),
      makeFinding({
        id: "55555555-5555-4555-8555-555555555555",
        file: "src/user.ts",
        lineStart: 23,
        title: "Guard missing user name",
        body: "The code assumes the user name is always present.",
        suggestion: { code: "return formatUser(user.name;", committable: false },
      }),
    ];
    const diff = makeDiff("src/user.ts", [22, 23]);

    // When Sovri formats the inline comment bodies
    const comments = buildInlineComments(findings, diff);

    // Then neither inline body contains a fenced "suggestion" block
    expect(comments).toHaveLength(2);
    for (const comment of comments) {
      expect(comment.body).not.toContain("```suggestion");
    }
  });

  it("keeps audit reference before the suggestion block and the finding marker last", () => {
    // Given the finding audit_reference is "SOVRI-AC-AB12-CD34"
    // And the finding suggestion.code is "const token = readSecret(\"API_TOKEN\");"
    // And suggestion.committable is true
    const findings: Finding[] = [
      makeFinding({
        file: "src/security.ts",
        lineStart: 31,
        title: "Avoid hardcoded credential",
        body: "The token is embedded directly in source code.",
        auditReference: "SOVRI-AC-AB12-CD34",
        suggestion: { code: 'const token = readSecret("API_TOKEN");', committable: true },
      }),
    ];
    const diff = makeDiff("src/security.ts", [31]);

    // When Sovri formats the inline comment body
    const comments = buildInlineComments(findings, diff);
    const body = comments[0]?.body ?? "";

    // Then the audit reference line appears before the suggestion block
    expect(body.indexOf("🔍 Audit Reference: SOVRI-AC-AB12-CD34")).toBeLessThan(
      body.indexOf("```suggestion"),
    );
    // And the suggestion block appears before the rendered marker
    expect(body.indexOf("```suggestion")).toBeLessThan(body.indexOf("<!-- sovri-finding-id:"));
    // And the inline body's last line is the rendered finding marker
    expect(lastLine(body)).toMatch(/^<!-- sovri-finding-id: [0-9a-f]{16} -->$/u);
  });

  it("omits the audit reference placeholder while still rendering a committable suggestion", () => {
    // Given the finding has no audit_reference
    // And the finding suggestion.code is "const total = amount ?? 0;"
    // And suggestion.committable is true
    const findings: Finding[] = [
      makeFinding({
        file: "src/totals.ts",
        lineStart: 14,
        title: "Use an explicit fallback",
        body: "The total can be undefined before formatting.",
        suggestion: { code: "const total = amount ?? 0;", committable: true },
      }),
    ];
    const diff = makeDiff("src/totals.ts", [14]);

    // When Sovri formats the inline comment body
    const comments = buildInlineComments(findings, diff);

    // Then the inline body contains no "🔍 Audit Reference:" line
    expect(comments[0]?.body).not.toContain("🔍 Audit Reference:");
    // And the inline body contains a fenced "suggestion" block
    expect(comments[0]?.body).toContain("```suggestion");
  });

  it("rejects a committable suggestion on a multi-line inline anchor", () => {
    // Given the finding line_start is 14
    // And the finding line_end is 15
    // And suggestion.committable is true
    const findings: Finding[] = [
      makeFinding({
        file: "src/totals.ts",
        lineStart: 14,
        lineEnd: 15,
        title: "Use an explicit fallback",
        body: "The total can be undefined before formatting.",
        suggestion: { code: "const total = amount ?? 0;", committable: true },
      }),
    ];
    const diff = makeDiff("src/totals.ts", [14, 15]);

    // When Sovri builds the inline comment draft
    const build = () => buildInlineComments(findings, diff);

    // Then inline draft building fails before returning a draft
    // And the failure mentions "committable suggestion requires a single-line inline anchor"
    expect(build).toThrow("committable suggestion requires a single-line inline anchor");
  });

  it("keeps the existing multi-line anchor for non-committable suggestions", () => {
    // Given the finding line_start is 14
    // And the finding line_end is 15
    // And suggestion.committable is false
    const findings: Finding[] = [
      makeFinding({
        file: "src/totals.ts",
        lineStart: 14,
        lineEnd: 15,
        title: "Use an explicit fallback",
        body: "The total can be undefined before formatting.",
        suggestion: { code: "const total = amount ?? 0;\nreturn total;", committable: false },
      }),
    ];
    const diff = makeDiff("src/totals.ts", [14, 15]);

    // When Sovri builds the inline comment draft
    const comments = buildInlineComments(findings, diff);

    // Then the inline draft start_line is 14
    expect(comments[0]?.start_line).toBe(14);
    // And the inline draft line is 15
    expect(comments[0]?.line).toBe(15);
    // And the inline body contains no fenced "suggestion" block
    expect(comments[0]?.body).not.toContain("```suggestion");
  });
});

function makeFinding(options: {
  readonly id?: string;
  readonly auditReference?: string;
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd?: number;
  readonly title: string;
  readonly body: string;
  readonly suggestion?: Finding["suggestion"];
}): Finding {
  return {
    id: options.id ?? "44444444-4444-4444-8444-444444444444",
    ...(options.auditReference === undefined ? {} : { audit_reference: options.auditReference }),
    severity: "minor",
    category: "maintainability",
    file: options.file,
    line_start: options.lineStart,
    line_end: options.lineEnd ?? options.lineStart,
    title: options.title,
    body: options.body,
    ...(options.suggestion === undefined ? {} : { suggestion: options.suggestion }),
    source: "llm",
    confidence: 0.86,
  };
}

function lastLine(body: string): string {
  return body.split("\n").at(-1) ?? "";
}
