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
  summary: "Findings are sorted by severity.",
  findings: [],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough severity ordering", () => {
  it.each([
    {
      higher: "blocker",
      lower: "major",
      higherTitle: "Unvalidated session token",
      lowerTitle: "Missing payload null guard",
    },
    {
      higher: "major",
      lower: "minor",
      higherTitle: "Missing payload null guard",
      lowerTitle: "Duplicated condition",
    },
    {
      higher: "minor",
      lower: "info",
      higherTitle: "Duplicated condition",
      lowerTitle: "Document fallback path",
    },
    {
      higher: "info",
      lower: "nitpick",
      higherTitle: "Document fallback path",
      lowerTitle: "Prefer clearer variable name",
    },
  ] satisfies ReadonlyArray<{
    readonly higher: Finding["severity"];
    readonly lower: Finding["severity"];
    readonly higherTitle: string;
    readonly lowerTitle: string;
  }>)(
    "renders $higherTitle before $lowerTitle when lower severity appears first",
    ({ higher, lower, higherTitle, lowerTitle }) => {
      // Given the review contains a <higher> finding titled <higherTitle>
      const higherFinding = finding({
        id: "77777777-7777-4777-8777-777777777777",
        severity: higher,
        lineStart: 20,
        title: higherTitle,
      });
      // And the review contains a <lower> finding titled <lowerTitle>
      const lowerFinding = finding({
        id: "88888888-8888-4888-8888-888888888888",
        severity: lower,
        lineStart: 10,
        title: lowerTitle,
      });
      const review: Review = {
        ...baseReview,
        findings: [lowerFinding, higherFinding],
      };

      // When the maintainer calls `composeWalkthrough(review)`
      const markdown = composeWalkthrough(review);

      // Then <higherTitle> appears before <lowerTitle>
      expect(indexOfRenderedTitle(markdown, higherTitle)).toBeLessThan(
        indexOfRenderedTitle(markdown, lowerTitle),
      );
    },
  );
});

type FindingInput = {
  readonly id: string;
  readonly severity: Finding["severity"];
  readonly lineStart: number;
  readonly title: string;
};

function finding(input: FindingInput): Finding {
  return {
    id: input.id,
    severity: input.severity,
    category: "bug",
    file: "src/review/sorted.ts",
    line_start: input.lineStart,
    line_end: input.lineStart,
    title: input.title,
    body: `Review details for ${input.title}.`,
    source: "llm",
    confidence: 0.87,
  };
}

function indexOfRenderedTitle(markdown: string, title: string): number {
  const index = markdown.indexOf(title);

  if (index < 0) {
    throw new Error(`Missing rendered finding title: ${title}`);
  }

  return index;
}
