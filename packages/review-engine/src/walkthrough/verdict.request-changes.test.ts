// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, computeVerdict, type WalkthroughInput } from "./index.js";

// Rule R-02 — any finding ranked at or above major forces a request-changes verdict, regardless of
// how many minor/info/nitpick findings accompany it.

let findingSeq = 0;
function makeFinding(severity: Severity, title: string): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `11111111-1111-4111-8111-${hex}`,
    severity,
    category: "bug",
    file: "src/review.ts",
    line_start: findingSeq,
    line_end: findingSeq,
    title,
    body: `Body for ${title}.`,
    recommendation: `Resolve the issue in ${title}.`,
    source: "llm",
    confidence: 0.8,
  };
}

const baseReview: Omit<Review, "findings"> = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "The PR has at least one blocking issue.",
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

const lowSeverityNoise: readonly Finding[] = [
  makeFinding("minor", "Minor one"),
  makeFinding("minor", "Minor two"),
  makeFinding("minor", "Minor three"),
  makeFinding("info", "Info one"),
  makeFinding("info", "Info two"),
  makeFinding("nitpick", "Nitpick one"),
];

describe("walkthrough verdict — blocking severities (R-02)", () => {
  it.each(["blocker", "major"] satisfies Severity[])(
    "computes request-changes when a %s finding sits among low-severity noise",
    (severity) => {
      // Given a review whose findings include one "<severity>" finding
      // And three "minor" findings, two "info" findings, and one "nitpick" finding
      const review: Review = {
        ...baseReview,
        findings: [makeFinding(severity, `${severity} issue`), ...lowSeverityNoise],
      };

      // When the verdict is computed from the findings
      const verdict = computeVerdict(review.findings);

      // Then the verdict kind is "request-changes"
      expect(verdict.kind).toBe("request-changes");
    },
  );

  it("heads the walkthrough with the request-changes banner", () => {
    // Given a review with 1 blocker finding and 2 minor findings
    const review: Review = {
      ...baseReview,
      findings: [
        makeFinding("blocker", "Unvalidated token"),
        makeFinding("minor", "Duplicated condition"),
        makeFinding("minor", "Unused import"),
      ],
    };

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the composed output begins with the heading "## ❌ Request changes"
    expect(markdown.startsWith("## ❌ Request changes")).toBe(true);
  });
});
