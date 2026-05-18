// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema, z, type Diff, type PullRequest, type Severity } from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import { reviewPullRequest } from "./orchestrator.js";

type ReviewPullRequestRuntime = (
  input: {
    readonly pullRequest: unknown;
    readonly diff: Diff;
    readonly config: ReviewFilterConfig;
  },
  options: { readonly provider: LLMProvider },
) => Promise<unknown>;

interface ReviewFilterConfig {
  readonly review: {
    readonly severityThreshold: Severity;
  };
  readonly ignores: readonly string[];
  readonly limits: {
    readonly maxFilesPerReview: number;
    readonly maxLinesPerReview: number;
  };
}

class CompleteReviewProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const generation = await this.generateStructuredWithUsage(params);

    return generation.data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    this.calls += 1;

    return {
      data: params.schema.parse({
        summary: "One major orchestration finding.",
        findings: [
          {
            severity: "major",
            category: "bug",
            file: "packages/review-engine/src/orchestrator.ts",
            line_start: 42,
            line_end: 42,
            title: "Missing orchestration guard",
            body: "The orchestration path should preserve the complete Review contract.",
            confidence: 0.91,
          },
        ],
        walkthrough_markdown: "## Sovri review\n\nOne major orchestration finding.",
      }),
      tokenUsage: { prompt: 812, completion: 144 },
    };
  }
}

describe("reviewPullRequest complete Review contract", () => {
  it("returns every required Review field for a valid provider response", async () => {
    const provider = new CompleteReviewProvider();

    // Given the parsed diff contains file "packages/review-engine/src/orchestrator.ts" with RIGHT-side line 42
    // And the provider returns summary "One major orchestration finding."
    // And the provider returns one "major" finding for file "packages/review-engine/src/orchestrator.ts" on line 42
    // And the provider reports 812 prompt tokens and 144 completion tokens
    // When the maintainer calls `reviewPullRequest`
    const review = ReviewSchema.parse(
      await reviewPullRequest({ pullRequest, diff, config }, { provider }),
    );

    // Then the returned Review has a UUID `id`
    expect(review.id).toMatch(UuidPattern);
    // And the returned Review has pull request number 38
    expect(review.pr_number).toBe(38);
    // And the returned Review has repository "mpiton/sovri"
    expect(review.repo_full_name).toBe("mpiton/sovri");
    // And the returned Review has commit SHA "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(review.commit_sha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    // And the returned Review has LLM provider "test-provider"
    expect(review.llm_provider).toBe("test-provider");
    // And the returned Review has LLM model "test-model"
    expect(review.llm_model).toBe("test-model");
    // And the returned Review has non-empty `summary`
    expect(review.summary).toBe("One major orchestration finding.");
    // And the returned Review has non-empty `walkthrough_markdown`
    expect(review.walkthrough_markdown.length).toBeGreaterThan(0);
    // And the returned Review has status "success"
    expect(review.status).toBe("success");

    expect(review.tokens_used).toEqual({ prompt: 812, completion: 144 });
    expect(review.completed_at.getTime()).toBeGreaterThanOrEqual(review.started_at.getTime());
    expect(review.findings).toEqual([
      expect.objectContaining({
        severity: "major",
        category: "bug",
        file: "packages/review-engine/src/orchestrator.ts",
        line_start: 42,
        line_end: 42,
        title: "Missing orchestration guard",
        source: "llm",
        confidence: 0.91,
      }),
    ]);
  });

  it("rejects invalid pull request input before calling the provider", async () => {
    const provider = new CompleteReviewProvider();
    const runtimeReviewPullRequest = getReviewPullRequestRuntime();

    // Given the pull request head SHA is "not-a-sha"
    const invalidPullRequest = {
      ...pullRequest,
      head_sha: "not-a-sha",
    };

    // When the maintainer calls `reviewPullRequest`
    const review = runtimeReviewPullRequest(
      { pullRequest: invalidPullRequest, diff, config },
      { provider },
    );

    // Then validation fails before the provider is called
    await expect(review).rejects.toBeInstanceOf(z.ZodError);
    expect(provider.calls).toBe(0);
  });
});

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isReviewPullRequestRuntime(value: unknown): value is ReviewPullRequestRuntime {
  return typeof value === "function";
}

function getReviewPullRequestRuntime(): ReviewPullRequestRuntime {
  const candidate: unknown = reviewPullRequest;

  expect(isReviewPullRequestRuntime(candidate)).toBe(true);

  if (!isReviewPullRequestRuntime(candidate)) {
    throw new TypeError("reviewPullRequest is not callable");
  }

  return candidate;
}

const config: ReviewFilterConfig = {
  review: { severityThreshold: "major" },
  ignores: [],
  limits: {
    maxFilesPerReview: 5,
    maxLinesPerReview: 50,
  },
};

const pullRequest: PullRequest = {
  number: 38,
  repo_full_name: "mpiton/sovri",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/review-orchestrator",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Implement orchestrator.ts",
  body: "Wire parsing, filtering, and review output.",
  additions: 1,
  deletions: 1,
  changed_files: 1,
};

const diff: Diff = {
  unified_diff: `diff --git a/packages/review-engine/src/orchestrator.ts b/packages/review-engine/src/orchestrator.ts
index 1111111..2222222 100644
--- a/packages/review-engine/src/orchestrator.ts
+++ b/packages/review-engine/src/orchestrator.ts
@@ -40,3 +40,3 @@ export async function reviewPullRequest()
 const startedAt = new Date();
-const review = await runReview(input, options);
+const review = await generateParsedProviderReview(options.provider, params);
 return review;
`,
  files: [
    {
      path: "packages/review-engine/src/orchestrator.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
      patch: `@@ -40,3 +40,3 @@ export async function reviewPullRequest()
 const startedAt = new Date();
-const review = await runReview(input, options);
+const review = await generateParsedProviderReview(options.provider, params);
 return review;`,
      hunks: [
        {
          old_start: 40,
          old_lines: 3,
          new_start: 40,
          new_lines: 3,
          header: "@@ -40,3 +40,3 @@ export async function reviewPullRequest()",
          lines: [
            " const startedAt = new Date();",
            "-const review = await runReview(input, options);",
            "+const review = await generateParsedProviderReview(options.provider, params);",
            " return review;",
          ],
        },
      ],
    },
  ],
};
