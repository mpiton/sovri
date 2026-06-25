// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import type { Finding, Review, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { computeVerdict } from "./index.js";

// Rule R-03 — a review whose findings are all below major (minor, info, nitpick only) computes
// approve; the verdict threshold sits exactly at major.

let findingSeq = 0;
function makeFinding(severity: Severity): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `22222222-2222-4222-8222-${hex}`,
    severity,
    category: "bug",
    file: "src/review.ts",
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    source: "llm",
    confidence: 0.7,
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
  summary: "Only low-severity findings remain.",
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

function reviewOf(severities: readonly Severity[]): Review {
  return { ...baseReview, findings: severities.map(makeFinding) };
}

describe("walkthrough verdict — below-major findings approve (R-03)", () => {
  it.each([
    [["minor"]],
    [["info"]],
    [["nitpick"]],
    [["minor", "info", "nitpick"]],
  ] satisfies ReadonlyArray<[Severity[]]>)(
    "computes approve when the findings are only %j",
    (severities) => {
      // Given a review whose findings are only of severity "<severities>"
      const review = reviewOf(severities);

      // When the verdict is computed from the findings
      const verdict = computeVerdict(review.findings);

      // Then the verdict kind is "approve"
      expect(verdict.kind).toBe("approve");
    },
  );

  it("keeps one minor finding on the approve side of the boundary", () => {
    // Given a review with exactly 1 minor finding
    const review = reviewOf(["minor"]);

    // When the verdict is computed from the findings
    const verdict = computeVerdict(review.findings);

    // Then the verdict kind is "approve"
    expect(verdict.kind).toBe("approve");
  });

  it("crosses to request-changes for one major finding", () => {
    // Given a review with exactly 1 major finding
    const review = reviewOf(["major"]);

    // When the verdict is computed from the findings
    const verdict = computeVerdict(review.findings);

    // Then the verdict kind is "request-changes"
    expect(verdict.kind).toBe("request-changes");
  });
});
