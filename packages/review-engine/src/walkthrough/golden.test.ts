// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema, FindingSchema, type Review } from "@sovri/core";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const FixtureReviewSchema = z.object({
  id: z.string(),
  pr_number: z.number(),
  repo_full_name: z.string(),
  commit_sha: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  llm_provider: z.string(),
  llm_model: z.string(),
  tokens_used: z.object({
    prompt: z.number(),
    completion: z.number(),
  }),
  summary: z.string(),
  findings: z.array(FindingSchema),
  walkthrough_markdown: z.string(),
  status: z.enum(["success", "partial", "failed"]),
});

describe("composeWalkthrough golden fixtures", () => {
  it.each([
    ["multi-finding.review.json", "multi-finding.golden.md", "### File-by-file"],
    ["no-findings.review.json", "no-findings.golden.md", "No changed files with findings"],
    [
      "html-escaping.review.json",
      "html-escaping.golden.md",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ],
    [
      "multiline-body.review.json",
      "multiline-body.golden.md",
      "The review payload is read before validation. Add a schema parse before accessing nested fields.",
    ],
  ])("matches %s against %s", (reviewFixture, goldenFixture, requiredText) => {
    const review = loadReviewFixture(reviewFixture);
    const expectedMarkdown = loadTextFixture(goldenFixture);

    const markdown = composeWalkthrough(review);

    expectGoldenMatch(markdown, expectedMarkdown, goldenFixture);
    expect(expectedMarkdown).toContain(requiredText);
  });

  it.each(["multi-finding.golden.md", "no-findings.golden.md", "html-escaping.golden.md"])(
    "asserts required layout sections in %s",
    (goldenFixture) => {
      // Given the fixture expected output is <goldenFixture>
      const expectedMarkdown = loadTextFixture(goldenFixture);

      // When the maintainer runs the walkthrough tests
      // Then the golden output contains "### TL;DR"
      expect(expectedMarkdown).toContain("### TL;DR");
      // And the golden output contains "### Findings"
      expect(expectedMarkdown).toContain("### Findings");
      // And the golden output contains "### File-by-file"
      expect(expectedMarkdown).toContain("### File-by-file");
    },
  );

  it.each([
    [
      "multi-finding.review.json",
      "the ### File-by-file heading omitted",
      "multi-finding.golden.md",
      (markdown: string) => markdown.replace("\n### File-by-file\n", "\n"),
    ],
    [
      "html-escaping.review.json",
      "the escaped script tag rendered as HTML",
      "html-escaping.golden.md",
      (markdown: string) =>
        markdown.replace("&lt;script&gt;alert(1)&lt;/script&gt;", "<script>alert(1)</script>"),
    ],
  ])(
    "rejects golden layout drift in %s: %s",
    (reviewFixture, _drift, goldenFixture, introduceDrift) => {
      // Given the generated markdown for <reviewFixture> has <drift>
      const review = loadReviewFixture(reviewFixture);
      const driftedMarkdown = introduceDrift(composeWalkthrough(review));
      // And the fixture expected output is <goldenFixture>
      const expectedMarkdown = loadTextFixture(goldenFixture);

      // When the maintainer runs the walkthrough tests
      // Then the golden comparison fails
      // And the failure identifies <goldenFixture>
      expect(() => expectGoldenMatch(driftedMarkdown, expectedMarkdown, goldenFixture)).toThrow(
        goldenFixture,
      );
    },
  );
});

function expectGoldenMatch(
  markdown: string,
  expectedMarkdown: string,
  goldenFixture: string,
): void {
  if (markdown !== expectedMarkdown) {
    throw new Error(`Golden fixture mismatch: ${goldenFixture}`);
  }
}

function loadReviewFixture(name: string): Review {
  const fixture = FixtureReviewSchema.parse(JSON.parse(loadTextFixture(name)));

  return ReviewSchema.parse({
    ...fixture,
    started_at: new Date(fixture.started_at),
    completed_at: new Date(fixture.completed_at),
  });
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8").trimEnd();
}
