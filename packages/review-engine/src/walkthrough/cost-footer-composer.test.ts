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
  recommendation: "Add a null check on the payload before accessing its properties.",
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
  llm_provider: "anthropic",
  llm_model: "claude-sonnet-4-6",
  tokens_used: {
    prompt: 1234,
    completion: 567,
  },
  summary: "Review completed.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough cost footer", () => {
  it("keeps the walkthrough complete without a footer when token usage is undefined", () => {
    // Given a review for PR 36 in "mpiton/sovri"
    // And the review summary is "Review completed."
    // And the review uses provider "anthropic" with model "claude-sonnet-4-6"
    // And the review token usage is undefined
    const { tokens_used: _tokensUsed, ...reviewWithoutUsage } = baseReview;
    // And the review contains a major finding titled "Missing payload null guard"
    expect(reviewWithoutUsage.findings[0]?.title).toBe("Missing payload null guard");

    // When the walkthrough Markdown is composed
    const markdown = composeWalkthrough(reviewWithoutUsage);

    // Then the Markdown contains the verdict banner heading (major finding → request changes)
    expect(markdown).toContain("## ❌ Request changes");
    // And the Markdown contains "### TL;DR"
    expect(markdown).toContain("### TL;DR");
    // And the Markdown contains "### Findings"
    expect(markdown).toContain("### Findings");
    // And the Markdown contains "### File-by-file"
    expect(markdown).toContain("### File-by-file");
    // And the Markdown does not contain "Tokens:"
    expect(markdown).not.toContain("Tokens:");
    // And the Markdown does not contain "Estimated cost:"
    expect(markdown).not.toContain("Estimated cost:");
  });

  it.each([
    {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1234,
      completionTokens: 567,
      findings: [baseFinding],
    },
    {
      provider: "mistral",
      model: "mistral-large-latest",
      promptTokens: 2048,
      completionTokens: 256,
      findings: [],
    },
  ])(
    "renders the $provider $model cost footer after all walkthrough sections",
    ({ provider, model, promptTokens, completionTokens, findings }) => {
      // Given a review for PR 36 in "mpiton/sovri"
      // And the review summary is "Review completed."
      // And the review uses provider "<provider>" with model "<model>"
      // And the review token usage is <prompt_tokens> prompt tokens and <completion_tokens> completion tokens
      // And the review contains <finding_count> finding
      const review = {
        ...baseReview,
        llm_provider: provider,
        llm_model: model,
        tokens_used: {
          prompt: promptTokens,
          completion: completionTokens,
        },
        token_usage_reported: true,
        findings,
      };

      // When the walkthrough Markdown is composed
      const markdown = composeWalkthrough(review);
      const footer = lastNonEmptyLine(markdown);

      // Then the Markdown contains "### Findings"
      expect(markdown).toContain("### Findings");
      // And the Markdown contains "### File-by-file"
      expect(markdown).toContain("### File-by-file");
      // And the Markdown ends with "_Tokens: <prompt_tokens> in / <completion_tokens> out"
      expect(footer).toContain(
        `_Tokens: ${String(promptTokens)} in / ${String(completionTokens)} out`,
      );
      expect(markdown.endsWith(footer)).toBe(true);
      // And "### Findings" appears before "### File-by-file"
      expect(sectionIndex(markdown, "### Findings")).toBeLessThan(
        sectionIndex(markdown, "### File-by-file"),
      );
      // And "### File-by-file" appears before the cost footer
      expect(sectionIndex(markdown, "### File-by-file")).toBeLessThan(markdown.indexOf(footer));
    },
  );

  it.each([
    {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1234,
      completionTokens: 567,
      findings: [baseFinding],
    },
    {
      provider: "mistral",
      model: "mistral-large-latest",
      promptTokens: 2048,
      completionTokens: 256,
      findings: [],
    },
  ])(
    "renders a horizontal rule before the $provider $model cost footer",
    ({ provider, model, promptTokens, completionTokens, findings }) => {
      // Given a review for PR 36 in "mpiton/sovri"
      // And the review uses provider "<provider>" with model "<model>"
      // And the review token usage is <prompt_tokens> prompt tokens and <completion_tokens> completion tokens
      // And the review contains <finding_count> finding
      const review = {
        ...baseReview,
        llm_provider: provider,
        llm_model: model,
        tokens_used: {
          prompt: promptTokens,
          completion: completionTokens,
        },
        token_usage_reported: true,
        findings,
      };

      // When the walkthrough Markdown is composed
      const markdown = composeWalkthrough(review);
      const lines = markdown.split("\n");
      const separatorIndex = lines.lastIndexOf("---");

      // Then the Markdown contains a horizontal rule line "---"
      expect(separatorIndex).toBeGreaterThanOrEqual(0);
      const footer = firstNonEmptyLineAfter(lines, separatorIndex);
      // And the first non-empty line after the final horizontal rule is the cost footer
      expect(footer).toBe(lastNonEmptyLine(markdown));
      // And the cost footer contains "Tokens: <prompt_tokens> in / <completion_tokens> out"
      expect(footer).toContain(
        `Tokens: ${String(promptTokens)} in / ${String(completionTokens)} out`,
      );
    },
  );

  it("omits the footer when zero token usage is a synthetic default", () => {
    // Given a review for PR 36 in "mpiton/sovri"
    // And the review token usage is 0 prompt tokens and 0 completion tokens
    // And no provider usage signal is present
    const review: Review = {
      ...baseReview,
      tokens_used: {
        prompt: 0,
        completion: 0,
      },
    };

    // When the walkthrough Markdown is composed
    const markdown = composeWalkthrough(review);

    // Then the Markdown does not contain "Tokens:"
    expect(markdown).not.toContain("Tokens:");
    // And the Markdown does not contain "Estimated cost:"
    expect(markdown).not.toContain("Estimated cost:");
  });
});

function lastNonEmptyLine(markdown: string): string {
  const line = markdown
    .split("\n")
    .toReversed()
    .find((candidate) => candidate.length > 0);

  if (line === undefined) {
    throw new Error("Expected walkthrough Markdown to contain at least one line");
  }

  return line;
}

function sectionIndex(markdown: string, heading: string): number {
  const index = markdown.indexOf(heading);

  if (index < 0) {
    throw new Error(`Missing walkthrough section: ${heading}`);
  }

  return index;
}

function firstNonEmptyLineAfter(lines: readonly string[], index: number): string {
  const line = lines.slice(index + 1).find((candidate) => candidate.length > 0);

  if (line === undefined) {
    throw new Error("Expected a non-empty line after the horizontal rule");
  }

  return line;
}
