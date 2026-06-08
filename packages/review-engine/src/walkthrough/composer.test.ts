// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: {
    prompt: 1200,
    completion: 300,
  },
  summary: "Review completed.",
  findings: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      severity: "major",
      category: "bug",
      file: "src/api/review.ts",
      line_start: 18,
      line_end: 18,
      title: "Missing payload null guard",
      body: "The review payload is read before validation.",
      recommendation: "Add a null check on the payload before accessing its properties.",
      source: "llm",
      confidence: 0.87,
    },
  ],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough", () => {
  it("does not invent inline comment anchors when the review has no inline comment URLs", () => {
    // Given the review contains a major finding with id "11111111-1111-4111-8111-111111111111"
    // And the finding file is "src/api/review.ts"
    // And the finding line_start is 18
    // And the finding title is "Missing payload null guard"
    const review = baseReview;

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the markdown contains "Missing payload null guard"
    expect(markdown).toContain("Missing payload null guard");
    // And the markdown does not contain "#discussion_r"
    expect(markdown).not.toContain("#discussion_r");
    // And the markdown does not contain "inline comment"
    expect(markdown).not.toContain("inline comment");
    // And the markdown does not use "11111111-1111-4111-8111-111111111111" as an anchor target
    expect(markdown).not.toContain("(#11111111-1111-4111-8111-111111111111)");
  });

  it.each([
    "[inline comment](#discussion_r123456789)",
    "[view comment](https://github.com/mpiton/sovri/pull/36#discussion_r123456789)",
  ])("does not render fabricated GitHub discussion links: %s", (fabricatedAnchor) => {
    // Given the review contains a finding without inline-comment URL metadata
    const review = baseReview;

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the markdown must not contain <fabricatedAnchor>
    expect(markdown).not.toContain(fabricatedAnchor);
    // And the markdown must not contain a generated GitHub comment URL
    expect(markdown).not.toMatch(/https:\/\/github\.com\/mpiton\/sovri\/pull\/36#discussion_r\d+/u);
  });

  it.each([
    [
      "See [inline comment](https://github.com/mpiton/sovri/pull/36#discussion_r123456789)",
      "See \\[inline comment\\](https://github.com/mpiton/sovri/pull/36#discussion_r123456789)",
      "See [inline comment](https://github.com/mpiton/sovri/pull/36#discussion_r123456789)",
    ],
    [
      "Refer to [discussion](#discussion_r987654321)",
      "Refer to \\[discussion\\](#discussion_r987654321)",
      "Refer to [discussion](#discussion_r987654321)",
    ],
  ])("renders anchor-like user text inert: %s", (body, inertText, activeText) => {
    // Given the finding body is <body>
    // And no inline-comment URL metadata is present on the review input
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          body,
        },
      ],
    };

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the markdown contains <inertText>
    expect(markdown).toContain(inertText);
    // And the markdown does not contain <activeText>
    expect(markdown).not.toContain(activeText);
    // And the composer does not promote the body link to the finding anchor
    expect(markdown).not.toContain("[Missing payload null guard](");
  });

  it("does not HTML-escape characters inside inline code spans", () => {
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          title: "Use `<button>` instead of `a && b`",
          body: "Replace `<div>` with `a && b` in `tag<T>` template.",
        },
      ],
    };

    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    expect(markdown).toContain("`<button>`");
    expect(markdown).toContain("`a && b`");
    expect(markdown).toContain("`<div>`");
    expect(markdown).toContain("`tag<T>`");
    expect(markdown).not.toContain("`&lt;button&gt;`");
    expect(markdown).not.toContain("`a &amp;&amp; b`");
  });

  it("does not escape brackets inside inline code spans", () => {
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          body: "Check `items[i]` before [discussion](#discussion_r987654321)",
        },
      ],
    };

    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    expect(markdown).toContain("`items[i]`");
    expect(markdown).not.toContain("`items\\[i\\]`");
    expect(markdown).toContain("\\[discussion\\](#discussion_r987654321)");
  });

  it("does not escape brackets inside multi-backtick code spans", () => {
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          body: "Check ``items[`index`]`` before [discussion](#discussion_r987654321)",
        },
      ],
    };

    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    expect(markdown).toContain("``items[`index`]``");
    expect(markdown).not.toContain("``items\\[`index`\\]``");
    expect(markdown).toContain("\\[discussion\\](#discussion_r987654321)");
  });

  it("does not treat escaped backticks as code span delimiters", () => {
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          body: "See \\`[discussion](#discussion_r987654321)\\`",
        },
      ],
    };

    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    expect(markdown).toContain("\\`\\[discussion\\](#discussion_r987654321)\\`");
    expect(markdown).not.toContain("\\`[discussion](#discussion_r987654321)\\`");
  });

  it("does not render inline comment anchors until trusted URL metadata exists", () => {
    // Given the review contains a finding for file "src/api/review.ts"
    // And the finding id is "11111111-1111-4111-8111-111111111111"
    // And the review input has no field named "inline_comment_url"
    const review = baseReview;

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the markdown contains the finding title
    expect(markdown).toContain("Missing payload null guard");
    // And the markdown contains no inline comment anchor for that finding
    const finding = review.findings[0];
    if (finding === undefined) {
      throw new Error("test review must contain one finding");
    }
    expect("inline_comment_url" in finding).toBe(false);
    expect(markdown).not.toContain("[Missing payload null guard](");
    expect(markdown).not.toContain("#discussion_r");
  });

  it("allows escaped backticks to close an already-open code span", () => {
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseReview.findings[0],
          body: "`code \\` [discussion](#discussion_r987654321)`",
        },
      ],
    };

    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    expect(markdown).toContain("`code \\` \\[discussion\\](#discussion_r987654321)`");
    expect(markdown).not.toContain("`code \\` [discussion](#discussion_r987654321)`");
  });
});
