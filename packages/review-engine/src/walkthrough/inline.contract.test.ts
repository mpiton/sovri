// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildInlineComments, InlineCommentDraftSchema } from "./inline.js";

const sha = "2".repeat(40);

describe("buildInlineComments payload contract", () => {
  it("returns an Octokit-ready single-line inline comment draft", () => {
    // Given a parsed diff contains file "src/auth.ts" with RIGHT-side line 42
    const diff = createAuthDiff();

    // And a finding targets file "src/auth.ts" from line 42 to line 42
    // And the finding title is "Missing authorization check"
    // And the finding body is "This path can be reached without verifying the session."
    const findings = [createAuthFinding()];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then exactly 1 inline comment draft is returned
    expect(comments).toHaveLength(1);
    // And the draft validates against `InlineCommentDraftSchema`
    const draft = InlineCommentDraftSchema.parse(comments[0]);
    // And the draft path is "src/auth.ts"
    expect(draft.path).toBe("src/auth.ts");
    // And the draft line is 42
    expect(draft.line).toBe(42);
    // And the draft side is "RIGHT"
    expect(draft.side).toBe("RIGHT");
    // And the draft body contains "Missing authorization check"
    expect(draft.body).toContain("Missing authorization check");
    // And the draft body contains "This path can be reached without verifying the session."
    expect(draft.body).toContain("This path can be reached without verifying the session.");
    // And the draft does not contain a `position` field
    expect(draft).not.toHaveProperty("position");
  });

  it("returns drafts with only GitHub Review API comment fields", () => {
    // Given a parsed diff contains file "src/auth.ts" with RIGHT-side line 42
    const diff = createAuthDiff();

    // And a finding targets file "src/auth.ts" from line 42 to line 42
    const findings = [createAuthFinding()];

    // When the maintainer calls `buildInlineComments(findings, diff)`
    const comments = buildInlineComments(findings, diff);

    // Then every draft contains only allowed fields
    // And the allowed fields are "path", "body", "line", "side", "start_line", and "start_side"
    const allowedFields = new Set(["path", "body", "line", "side", "start_line", "start_side"]);
    for (const draft of comments) {
      for (const key of Object.keys(draft)) {
        expect(allowedFields.has(key)).toBe(true);
      }
    }

    // And no draft contains finding-only metadata such as "severity", "category", "confidence", or "source"
    for (const draft of comments) {
      expect(draft).not.toHaveProperty("severity");
      expect(draft).not.toHaveProperty("category");
      expect(draft).not.toHaveProperty("confidence");
      expect(draft).not.toHaveProperty("source");
    }
  });

  it("rejects a draft that provides only one of start_line or start_side", () => {
    // Given a draft has start_line without start_side
    const startLineOnly = {
      path: "src/auth.ts",
      body: "Missing authorization check",
      start_line: 40,
      line: 42,
      side: "RIGHT",
    };
    // And another draft has start_side without start_line
    const startSideOnly = {
      path: "src/auth.ts",
      body: "Missing authorization check",
      start_side: "RIGHT",
      line: 42,
      side: "RIGHT",
    };

    // When the maintainer validates each draft against `InlineCommentDraftSchema`
    // Then both validations fail
    expect(() => InlineCommentDraftSchema.parse(startLineOnly)).toThrow();
    expect(() => InlineCommentDraftSchema.parse(startSideOnly)).toThrow();
  });

  it("rejects a malformed draft that omits line", () => {
    // Given an inline comment draft has path "src/auth.ts"
    // And the draft has body "Missing authorization check"
    // And the draft has side "RIGHT"
    // And the draft omits `line`
    const malformedDraft = {
      path: "src/auth.ts",
      body: "Missing authorization check",
      side: "RIGHT",
    };
    let adapterDraft: unknown;

    // When the maintainer validates the draft against `InlineCommentDraftSchema`
    const validateAndPass = () => {
      adapterDraft = InlineCommentDraftSchema.parse(malformedDraft);
    };

    // Then validation fails
    expect(validateAndPass).toThrow();
    // And the draft is not passed to the GitHub adapter
    expect(adapterDraft).toBeUndefined();
  });
});

function createAuthDiff(): Diff {
  const header = "@@ -42,0 +42,1 @@";
  const patch = [
    "diff --git a/src/auth.ts b/src/auth.ts",
    `index ${"0".repeat(40)}..${sha} 100644`,
    "--- a/src/auth.ts",
    "+++ b/src/auth.ts",
    header,
    "+return handler(request);",
  ].join("\n");

  return {
    unified_diff: patch,
    files: [
      {
        path: "src/auth.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        sha,
        patch,
        hunks: [
          {
            old_start: 42,
            old_lines: 0,
            new_start: 42,
            new_lines: 1,
            header,
            lines: ["+return handler(request);"],
          },
        ],
      },
    ],
  };
}

function createAuthFinding(): Finding {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    severity: "major",
    category: "security",
    file: "src/auth.ts",
    line_start: 42,
    line_end: 42,
    title: "Missing authorization check",
    body: "This path can be reached without verifying the session.",
    source: "llm",
    confidence: 0.92,
  };
}
