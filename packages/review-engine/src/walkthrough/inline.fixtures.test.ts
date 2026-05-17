// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { FindingSchema, z, type Finding } from "@sovri/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../diff/index.js";
import { buildInlineComments, InlineCommentDraftSchema } from "./inline.js";

describe("buildInlineComments fixture coverage", () => {
  it("matches the single-line inline comment draft fixture", () => {
    // Given fixture diff "inline-single-line.diff" contains file "src/handler.ts" with RIGHT-side line 27
    const diff = parseUnifiedDiff(loadTextFixture("inline-single-line.diff"));

    // And fixture findings "inline-single-line.findings.json" contains one finding on "src/handler.ts" line 27
    const findings = loadFindingsFixture("inline-single-line.findings.json");

    // And expected fixture "inline-single-line.comments.json" contains one inline comment draft for line 27
    const expectedComments = loadCommentsFixture("inline-single-line.comments.json");

    // When the maintainer runs the inline comment fixture test
    const comments = buildInlineComments(findings, diff);

    // Then the generated draft matches "inline-single-line.comments.json"
    expect(comments).toEqual(expectedComments);
    // And the generated draft validates against `InlineCommentDraftSchema`
    expect(z.array(InlineCommentDraftSchema).parse(comments)).toEqual(expectedComments);
  });
});

function loadFindingsFixture(name: string): readonly Finding[] {
  return z.array(FindingSchema).parse(JSON.parse(loadTextFixture(name)));
}

function loadCommentsFixture(name: string): unknown[] {
  return z.array(InlineCommentDraftSchema).parse(JSON.parse(loadTextFixture(name)));
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8").trimEnd();
}
