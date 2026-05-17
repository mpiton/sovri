// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema, type Finding, type Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 10,
  line_end: 10,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
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
  summary: "The PR needs one security fix before merge.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough markdown return value", () => {
  it.each([
    {
      summary: "The PR needs one security fix before merge.",
      findingCount: 1,
      expectedSummary: "The PR needs one security fix before merge.",
    },
    {
      summary: "",
      findingCount: 0,
      expectedSummary: "No summary provided.",
    },
  ] satisfies ReadonlyArray<{
    readonly summary: string;
    readonly findingCount: number;
    readonly expectedSummary: string;
  }>)(
    "renders TL;DR markdown for a valid review with $findingCount findings",
    ({ summary, findingCount, expectedSummary }) => {
      // Given the review validates against `ReviewSchema`
      // And the review summary is <summary>
      // And the review contains <findingCount> findings
      const review = ReviewSchema.parse({
        ...baseReview,
        summary,
        findings: findingCount === 0 ? [] : [baseFinding],
      });

      // When the maintainer calls `composeWalkthrough(review)`
      const markdown = composeWalkthrough(review);

      // Then the returned value is a string
      expect(typeof markdown).toBe("string");
      // And the markdown starts with "## Sovri review"
      expect(markdown.startsWith("## Sovri review")).toBe(true);
      // And the TL;DR section contains <expectedSummary>
      expect(extractSection(markdown, "### TL;DR")).toContain(expectedSummary);
      // And the markdown does not contain "[object Object]"
      expect(markdown).not.toContain("[object Object]");
    },
  );

  it("returns useful markdown for a valid review with no findings", () => {
    // Given the review validates against `ReviewSchema`
    // And the review summary is "No actionable findings were found."
    // And the review contains 0 findings
    const review = ReviewSchema.parse({
      ...baseReview,
      summary: "No actionable findings were found.",
      findings: [],
    });

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);

    // Then the returned value is a string
    expect(typeof markdown).toBe("string");
    // And the markdown contains "No actionable findings were found."
    expect(markdown).toContain("No actionable findings were found.");
    // And the markdown contains "No findings"
    expect(markdown).toContain("No findings");
    // And the markdown contains "### File-by-file"
    expect(markdown).toContain("### File-by-file");
  });

  it("rejects invalid review input without returning partial markdown", () => {
    // Given the review is missing required field "summary"
    const invalidReviewInput = Object.fromEntries(
      Object.entries(baseReview).filter(([key]) => key !== "summary"),
    );
    let markdown: string | undefined;

    // When the maintainer calls `composeWalkthrough(review)`
    const callComposer = (): void => {
      markdown = composeWalkthrough(invalidReviewInput);
    };

    // Then validation fails against `ReviewSchema`
    expect(callComposer).toThrow();
    expect(() => ReviewSchema.parse(invalidReviewInput)).toThrow();
    // And no partial markdown string is returned
    expect(markdown).toBeUndefined();
  });
});

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
