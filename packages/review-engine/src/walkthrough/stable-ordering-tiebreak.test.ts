// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

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
  summary: "Findings use stable tie-breaks.",
  findings: [],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough same-severity tie breaks", () => {
  it.each([
    {
      firstFile: "src/auth.ts",
      firstLine: 12,
      firstTitle: "Check app permissions",
      secondFile: "src/auth.ts",
      secondLine: 12,
      secondTitle: "Check installation",
      firstRendered: "src/auth.ts:12 Check app permissions",
      secondRendered: "src/auth.ts:12 Check installation",
    },
    {
      firstFile: "src/auth.ts",
      firstLine: 12,
      firstTitle: "Check installation",
      secondFile: "src/auth.ts",
      secondLine: 40,
      secondTitle: "Validate token",
      firstRendered: "src/auth.ts:12 Check installation",
      secondRendered: "src/auth.ts:40 Validate token",
    },
    {
      firstFile: "src/auth.ts",
      firstLine: 40,
      firstTitle: "Validate token",
      secondFile: "src/billing.ts",
      secondLine: 20,
      secondTitle: "Validate token",
      firstRendered: "src/auth.ts:40 Validate token",
      secondRendered: "src/billing.ts:20 Validate token",
    },
  ] satisfies ReadonlyArray<{
    readonly firstFile: string;
    readonly firstLine: number;
    readonly firstTitle: string;
    readonly secondFile: string;
    readonly secondLine: number;
    readonly secondTitle: string;
    readonly firstRendered: string;
    readonly secondRendered: string;
  }>)(
    "renders $firstRendered before $secondRendered",
    ({
      firstFile,
      firstLine,
      firstTitle,
      secondFile,
      secondLine,
      secondTitle,
      firstRendered,
      secondRendered,
    }) => {
      // Given the review contains a major finding for file <firstFile> at line <firstLine>
      const firstFinding = finding({
        id: "99999999-9999-4999-8999-999999999999",
        file: firstFile,
        line: firstLine,
        title: firstTitle,
      });
      // And the review contains a major finding for file <secondFile> at line <secondLine>
      const secondFinding = finding({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        file: secondFile,
        line: secondLine,
        title: secondTitle,
      });
      const review: Review = {
        ...baseReview,
        findings: [
          // And the second finding appears before the first finding in the input array
          secondFinding,
          firstFinding,
        ],
      };

      // When the maintainer calls `composeWalkthrough(review)`
      const markdown = composeWalkthrough(review);

      // Then <firstRendered> appears before <secondRendered>
      expect(indexOfRenderedSnippet(markdown, firstRendered)).toBeLessThan(
        indexOfRenderedSnippet(markdown, secondRendered),
      );
    },
  );
});

type FindingInput = {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly title: string;
};

function finding(input: FindingInput): Finding {
  return {
    id: input.id,
    severity: "major",
    category: "bug",
    file: input.file,
    line_start: input.line,
    line_end: input.line,
    title: input.title,
    body: `Review details for ${input.title}.`,
    source: "llm",
    confidence: 0.87,
  };
}

function indexOfRenderedSnippet(markdown: string, snippet: string): number {
  const index = markdown.indexOf(snippet);

  if (index < 0) {
    throw new Error(`Missing rendered finding snippet: ${snippet}`);
  }

  return index;
}
