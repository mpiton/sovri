// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-04 — the verdict header's total equals the number of findings and each listed per-severity
// count is exact. The count line lists only the severities that occur, in severity-rank order.

let findingSeq = 0;
function makeFinding(severity: Severity): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `33333333-3333-4333-8333-${hex}`,
    severity,
    category: "bug",
    file: "src/review.ts",
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    recommendation: `Fix finding ${findingSeq}.`,
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
  summary: "Counting findings.",
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

function countLineOf(severities: readonly Severity[]): string {
  const review: Review = { ...baseReview, findings: severities.map(makeFinding) };
  const markdown = composeWalkthrough(review as unknown as WalkthroughInput);
  const line = markdown.split("\n").find((candidate) => /^\d+ finding/.test(candidate));
  if (line === undefined) {
    throw new Error("no count line in walkthrough output");
  }
  return line;
}

describe("walkthrough verdict header — finding counts (R-04)", () => {
  it("totals the findings and lists only the severities that occur", () => {
    // Given a review with findings: blocker, major, major, nitpick
    // When the walkthrough is composed
    const countLine = countLineOf(["blocker", "major", "major", "nitpick"]);

    // Then the count summary line reads "4 findings — 1 blocker, 2 major, 1 nitpick"
    expect(countLine).toBe("4 findings — 1 blocker, 2 major, 1 nitpick");
    // And the count summary line does not mention "minor"
    expect(countLine).not.toContain("minor");
    // And the count summary line does not mention "info"
    expect(countLine).not.toContain("info");
  });

  it("lists every severity present, the listed counts summing to the total", () => {
    // Given a review with one finding of each severity
    // When the walkthrough is composed
    const countLine = countLineOf(["blocker", "major", "minor", "info", "nitpick"]);

    // Then the count summary line reads the full rank-ordered breakdown
    expect(countLine).toBe("5 findings — 1 blocker, 1 major, 1 minor, 1 info, 1 nitpick");
  });

  it("uses the singular noun in the total for a single finding", () => {
    // Given a review with a single major finding
    // When the walkthrough is composed
    const countLine = countLineOf(["major"]);

    // Then the count summary line reads "1 finding — 1 major"
    expect(countLine).toBe("1 finding — 1 major");
  });
});
