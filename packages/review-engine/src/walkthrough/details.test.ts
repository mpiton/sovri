// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/api/review.ts",
  line_start: 18,
  line_end: 18,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
  recommendation: "Add a null check on the payload before accessing nested fields.",
  source: "llm",
  confidence: 0.87,
};

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
  summary: "The PR has actionable review findings.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough finding details", () => {
  it.each([
    {
      severity: "major",
      file: "src/api/review.ts",
      lineStart: 18,
      lineEnd: 18,
      title: "Missing payload null guard",
      body: "The review payload is read before validation.",
      location: "src/api/review.ts:18",
    },
    {
      severity: "blocker",
      file: "src/auth/session.ts",
      lineStart: 42,
      lineEnd: 45,
      title: "Unvalidated session token",
      body: "The handler accepts a token without signature validation.",
      location: "src/auth/session.ts:42-45",
    },
  ] satisfies ReadonlyArray<{
    readonly severity: Finding["severity"];
    readonly file: string;
    readonly lineStart: number;
    readonly lineEnd: number;
    readonly title: string;
    readonly body: string;
    readonly location: string;
  }>)(
    "renders $severity finding location, title, and body",
    ({ severity, file, lineStart, lineEnd, title, body, location }) => {
      // Given the review contains a <severity> finding for file <file>
      // And the finding line_start is <lineStart>
      // And the finding line_end is <lineEnd>
      // And the finding title is <title>
      // And the finding body is <body>
      const review: Review = {
        ...baseReview,
        findings: [
          {
            ...baseFinding,
            severity,
            file,
            line_start: lineStart,
            line_end: lineEnd,
            title,
            body,
          },
        ],
      };

      // When the maintainer calls `composeWalkthrough(review)`
      const markdown = composeWalkthrough(review);

      // Then the markdown contains <location>
      expect(markdown).toContain(location);
      // And the markdown contains <title>
      expect(markdown).toContain(title);
      // And the markdown contains <body>
      expect(markdown).toContain(body);
    },
  );

  it("normalizes multiline finding bodies to one markdown-safe paragraph", () => {
    // Given the review contains a major finding for file "src/api/review.ts"
    // And the finding line_start is 18
    // And the finding line_end is 18
    // And the finding title is "Missing payload null guard"
    // And the finding body is:
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseFinding,
          body: [
            "The review payload is read before validation.",
            "Add a schema parse before accessing nested fields.",
          ].join("\n"),
        },
      ],
    };

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);

    // Then the markdown contains "The review payload is read before validation. Add a schema parse before accessing nested fields."
    expect(markdown).toContain(
      "The review payload is read before validation. Add a schema parse before accessing nested fields.",
    );
    // And the finding table row for "Missing payload null guard" contains no raw newline inside a table cell
    const row = markdown
      .split("\n")
      .find((line) => line.includes("Missing payload null guard") && line.includes("🔴"));
    expect(row).toBeDefined();
    expect(row).not.toContain("\n");
    // And the markdown does not contain "<br>"
    expect(markdown).not.toContain("<br>");
  });

  it("rejects finding detail coverage when body text is missing", () => {
    // Given the rendered markdown contains "src/api/review.ts:18"
    // And the rendered markdown contains "Missing payload null guard"
    // And the rendered markdown does not contain "The review payload is read before validation."
    const expectedDetail = {
      location: "src/api/review.ts:18",
      title: "Missing payload null guard",
      body: "The review payload is read before validation.",
    };
    const completeMarkdown = composeWalkthrough(baseReview);
    expectCompleteFindingDetail(completeMarkdown, expectedDetail);
    const incompleteMarkdown = completeMarkdown.replace(expectedDetail.body, "");
    expect(incompleteMarkdown).toContain(expectedDetail.location);
    expect(incompleteMarkdown).toContain(expectedDetail.title);
    expect(incompleteMarkdown).not.toContain(expectedDetail.body);

    // When the finding detail coverage is checked
    // Then the walkthrough is rejected as incomplete
    expect(() => expectCompleteFindingDetail(incompleteMarkdown, expectedDetail)).toThrow(
      "Incomplete walkthrough finding detail: The review payload is read before validation.",
    );
  });

  it.each([
    {
      file: "src/api/review.ts",
      countText: "2 findings",
      expectedFinding: "src/api/review.ts:18 Missing payload null guard",
    },
    {
      file: "src/api/review.ts",
      countText: "2 findings",
      expectedFinding: "src/api/review.ts:31 Duplicated branch",
    },
    {
      file: "src/auth/session.ts",
      countText: "1 finding",
      expectedFinding: "src/auth/session.ts:42-45 Unvalidated session token",
    },
  ] satisfies ReadonlyArray<{
    readonly file: string;
    readonly countText: string;
    readonly expectedFinding: string;
  }>)(
    "repeats $expectedFinding in the sorted file-by-file summary",
    ({ file, countText, expectedFinding }) => {
      // Given the review contains findings:
      const review: Review = {
        ...baseReview,
        findings: [
          {
            ...baseFinding,
            severity: "major",
            file: "src/api/review.ts",
            line_start: 18,
            line_end: 18,
            title: "Missing payload null guard",
            body: "The review payload is read before validation.",
          },
          {
            ...baseFinding,
            id: "22222222-2222-4222-8222-222222222222",
            severity: "minor",
            file: "src/api/review.ts",
            line_start: 31,
            line_end: 31,
            title: "Duplicated branch",
            body: "The branch repeats an existing condition.",
          },
          {
            ...baseFinding,
            id: "33333333-3333-4333-8333-333333333333",
            severity: "blocker",
            file: "src/auth/session.ts",
            line_start: 42,
            line_end: 45,
            title: "Unvalidated session token",
            body: "The handler accepts a token without signature validation.",
          },
        ],
      };

      // When the maintainer calls `composeWalkthrough(review)`
      const markdown = composeWalkthrough(review);
      const fileByFileSection = extractSection(markdown, "### File-by-file");

      // Then the File-by-file section contains <file>
      expect(fileByFileSection).toContain(`#### ${file}`);
      // And the File-by-file section contains <countText>
      expect(fileByFileSection).toContain(countText);
      // And the File-by-file section contains <expectedFinding>
      expect(fileByFileSection).toContain(expectedFinding);
      expect(fileByFileSection.indexOf("#### src/api/review.ts")).toBeLessThan(
        fileByFileSection.indexOf("#### src/auth/session.ts"),
      );
    },
  );
});

function expectCompleteFindingDetail(
  markdown: string,
  expected: {
    readonly location: string;
    readonly title: string;
    readonly body: string;
  },
): void {
  const missingDetails = [expected.location, expected.title, expected.body].filter(
    (detail) => !markdown.includes(detail),
  );

  if (missingDetails.length > 0) {
    throw new Error(`Incomplete walkthrough finding detail: ${missingDetails.join(", ")}`);
  }
}

function extractSection(markdown: string, heading: string): string {
  const headingStart = markdown.indexOf(heading);

  if (headingStart < 0) {
    throw new Error(`Missing walkthrough section: ${heading}`);
  }

  const sectionStart = headingStart + heading.length;
  const section = markdown.slice(sectionStart);
  const nextSectionStart = section.indexOf("\n### ");

  return nextSectionStart < 0 ? section : section.slice(0, nextSectionStart);
}
