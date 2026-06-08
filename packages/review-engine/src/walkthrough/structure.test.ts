// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
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
  summary: "Five review findings need attention.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough structure checks", () => {
  it("rejects walkthroughs missing the file-by-file section", () => {
    // Given the rendered markdown contains "### TL;DR"
    // And the rendered markdown contains "### Findings"
    // And the rendered markdown does not contain "### File-by-file"
    const completeMarkdown = composeWalkthrough(baseReview);
    expectCompleteWalkthroughStructure(completeMarkdown);
    const incompleteMarkdown = completeMarkdown.replace("\n### File-by-file\n", "\n");
    expect(incompleteMarkdown).toContain("### TL;DR");
    expect(incompleteMarkdown).toContain("### Findings");
    expect(incompleteMarkdown).not.toContain("### File-by-file");

    // When the walkthrough structure is checked
    // Then the walkthrough is rejected as incomplete
    expect(() => expectCompleteWalkthroughStructure(incompleteMarkdown)).toThrow(
      "Incomplete walkthrough structure: ### File-by-file",
    );
  });
});

function expectCompleteWalkthroughStructure(markdown: string): void {
  const missingSections = ["### TL;DR", "### Findings", "### File-by-file"].filter(
    (heading) => !markdown.includes(heading),
  );

  if (missingSections.length > 0) {
    throw new Error(`Incomplete walkthrough structure: ${missingSections.join(", ")}`);
  }
}
