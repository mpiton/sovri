// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, PullRequest, Severity } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import {
  reviewPullRequest,
  type ReviewPullRequestConfig,
  type ReviewPullRequestConfigMode,
} from "./orchestrator.js";
import { buildSystemPrompt } from "./prompt/builder.js";

class CapturingProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public systemPrompt: string | undefined;
  public userPrompt: string | undefined;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    this.systemPrompt = params.systemPrompt;
    this.userPrompt = params.userPrompt;

    return params.schema.parse({
      summary: "Reviewed one pull request.",
      findings: [],
      walkthrough_markdown: "No findings.",
    });
  }
}

describe("reviewPullRequest review mode plumbing", () => {
  it.each([
    { mode: "full" },
    { mode: "bugs-only" },
    { mode: "strict" },
    { mode: "minimal" },
  ] as const)("forwards review mode $mode to prompt construction", async ({ mode }) => {
    // Given the parsed review config has review mode <mode>.
    const provider = new CapturingProvider();

    // When the review orchestrator builds the review request.
    await reviewPullRequest({ pullRequest, diff, config: configForMode(mode) }, { provider });

    // Then the provider receives the system prompt for mode <mode>.
    expect(provider.systemPrompt).toBe(buildSystemPrompt({ mode }));
    // And the provider receives the same quoted user prompt diff for mode <mode>.
    expect(provider.userPrompt).toContain("```diff");
    expect(provider.userPrompt).toContain("src/transfer.ts");
    expect(provider.userPrompt).toContain("if (amountCents &gt; 1000000) return true");
  });

  it("defaults omitted review mode to the full-mode system prompt", async () => {
    // Given the parsed review config omitted review mode before schema defaults were applied.
    const provider = new CapturingProvider();

    // When the review orchestrator builds the review request.
    await reviewPullRequest({ pullRequest, diff, config: baseConfig }, { provider });

    // Then the provider receives the baseline full-mode system prompt.
    expect(provider.systemPrompt).toBe(buildSystemPrompt({ mode: "full" }));
    // And no unsupported mode fallback is used.
    expect(provider.systemPrompt).not.toContain("at most 3 findings");
  });

  it("routes strict config mode to the strict-mode system prompt", async () => {
    // Given a repository config sets `review.mode: strict`.
    const provider = new CapturingProvider();

    // When the orchestrator parses the input.
    await reviewPullRequest({ pullRequest, diff, config: configForMode("strict") }, { provider });

    // Then the provider receives the strict-mode system prompt.
    expect(provider.systemPrompt).toBe(buildSystemPrompt({ mode: "strict" }));
  });
});

function configForMode(mode: ReviewPullRequestConfigMode): ReviewPullRequestConfig {
  return {
    ...baseConfig,
    review: {
      ...baseConfig.review,
      mode,
    },
  };
}

const baseConfig: ReviewPullRequestConfig = {
  review: {
    severityThreshold: "minor" satisfies Severity,
  },
  ignores: [],
  limits: {
    maxFilesPerReview: 5,
    maxLinesPerReview: 50,
  },
};

const pullRequest: PullRequest = {
  number: 42,
  repo_full_name: "acme/payments",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/transfer-review",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Protect high-value transfers",
  body: "Reject invalid transfer state.",
  additions: 1,
  deletions: 1,
  changed_files: 1,
};

const diff: Diff = {
  unified_diff: `diff --git a/src/transfer.ts b/src/transfer.ts
index 1111111..2222222 100644
--- a/src/transfer.ts
+++ b/src/transfer.ts
@@ -1,3 +1,5 @@
 export function approve(amountCents: number): boolean {
+  if (amountCents > 1000000) return true;
   return amountCents > 0;
 }`,
  files: [
    {
      path: "src/transfer.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
      patch: `@@ -1,3 +1,5 @@
 export function approve(amountCents: number): boolean {
+  if (amountCents > 1000000) return true;
   return amountCents > 0;
 }`,
      hunks: [
        {
          old_start: 1,
          old_lines: 3,
          new_start: 1,
          new_lines: 5,
          header: "@@ -1,3 +1,5 @@",
          lines: [
            " export function approve(amountCents: number): boolean {",
            "+  if (amountCents > 1000000) return true;",
            "   return amountCents > 0;",
            " }",
          ],
        },
      ],
    },
  ],
};
