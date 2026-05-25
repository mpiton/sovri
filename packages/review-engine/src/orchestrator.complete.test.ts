// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  FindingSchema,
  ReviewSchema,
  z,
  type Diff,
  type PullRequest,
  type Severity,
} from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewPullRequest } from "./orchestrator.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  constructor(
    private readonly response: ProviderResponseFixture = MajorFindingProviderResponse,
    private readonly tokenUsage: TokenUsageFixture = { prompt: 812, completion: 144 },
  ) {}

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
        summary: this.response.summary,
        findings: this.response.findings,
        walkthrough_markdown: this.response.walkthroughMarkdown,
      }),
      tokenUsage: this.tokenUsage,
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
    // And no corrective retry is used
    expect(provider.calls).toBe(1);
    // And the returned Review error is absent
    expect(review.error).toBeUndefined();
    // And no returned finding is titled "review_failed"
    expect(review.findings.some((finding) => finding.title === "review_failed")).toBe(false);

    expect(review.tokens_used).toEqual({ prompt: 812, completion: 144 });
    expect(Reflect.get(review, "token_usage_reported")).toBe(true);
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

  it("returns a successful Review that validates against core schemas", async () => {
    const provider = new CompleteReviewProvider(SchemaValidationProviderResponse);

    // Given the provider returns summary "Review completed for orchestrator flow."
    // And the provider returns one finding for file "packages/review-engine/src/orchestrator.ts" on line 42
    // And the provider reports 812 prompt tokens and 144 completion tokens
    // When the maintainer calls `reviewPullRequest`
    const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then the returned Review validates against `ReviewSchema`
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    // And the Review pull request number is 38
    expect(review.pr_number).toBe(38);
    // And the Review repository is "mpiton/sovri"
    expect(review.repo_full_name).toBe("mpiton/sovri");
    // And the Review commit SHA is "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(review.commit_sha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    // And `started_at` is before or equal to `completed_at`
    expect(review.started_at.getTime()).toBeLessThanOrEqual(review.completed_at.getTime());
    // And every returned finding validates against `FindingSchema`
    expect(review.findings.every((finding) => FindingSchema.safeParse(finding).success)).toBe(true);
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

  it("rejects an assembled Review without token usage before returning it", async () => {
    const provider = new CompleteReviewProvider();
    const originalParse = ReviewSchema.parse.bind(ReviewSchema);

    vi.spyOn(ReviewSchema, "parse").mockImplementation((value: unknown) => {
      if (isSuccessfulReviewAssembly(value)) {
        const tokenlessReview: Record<string, unknown> = { ...value };
        delete tokenlessReview["tokens_used"];

        return originalParse(tokenlessReview);
      }

      return originalParse(value);
    });

    // Given the orchestrator has assembled a Review without `tokens_used`
    // When the orchestrator validates the assembled Review
    const review = reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then validation fails against `ReviewSchema`
    await expect(review).rejects.toBeInstanceOf(z.ZodError);
    // And the invalid Review is not returned to the caller
    expect(provider.calls).toBe(1);
  });

  it("returns a complete successful Review for a zero-finding provider response", async () => {
    const provider = new CompleteReviewProvider(ZeroFindingProviderResponse, {
      prompt: 700,
      completion: 32,
    });

    // Given the parsed diff contains file "packages/review-engine/src/orchestrator.ts" with RIGHT-side line 42
    // And the provider returns summary "No actionable findings."
    // And the provider returns 0 findings
    // And the provider reports 700 prompt tokens and 32 completion tokens
    // When the maintainer calls `reviewPullRequest`
    const review = ReviewSchema.parse(
      await reviewPullRequest({ pullRequest, diff, config }, { provider }),
    );

    // Then the returned Review has status "success"
    expect(review.status).toBe("success");
    // And the returned Review findings contain 0 findings
    expect(review.findings).toHaveLength(0);
    // And the returned Review has non-empty `walkthrough_markdown`
    expect(review.walkthrough_markdown.length).toBeGreaterThan(0);

    expect(review.summary).toBe("No actionable findings.");
    expect(review.tokens_used).toEqual({ prompt: 700, completion: 32 });
    expect(Reflect.get(review, "token_usage_reported")).toBe(true);
  });
});

const UuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface TokenUsageFixture {
  readonly prompt: number;
  readonly completion: number;
}

interface ProviderResponseFixture {
  readonly summary: string;
  readonly findings: readonly ProviderFindingFixture[];
  readonly walkthroughMarkdown: string;
}

interface ProviderFindingFixture {
  readonly severity: "major";
  readonly category: "bug";
  readonly file: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly title: string;
  readonly body: string;
  readonly confidence: number;
}

const MajorFindingProviderResponse: ProviderResponseFixture = {
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
  walkthroughMarkdown: "## Sovri review\n\nOne major orchestration finding.",
};

const SchemaValidationProviderResponse: ProviderResponseFixture = {
  summary: "Review completed for orchestrator flow.",
  findings: [
    {
      severity: "major",
      category: "bug",
      file: "packages/review-engine/src/orchestrator.ts",
      line_start: 42,
      line_end: 42,
      title: "Schema-valid finding",
      body: "The returned finding should satisfy the core FindingSchema.",
      confidence: 0.91,
    },
  ],
  walkthroughMarkdown: "## Sovri review\n\nReview completed for orchestrator flow.",
};

const ZeroFindingProviderResponse: ProviderResponseFixture = {
  summary: "No actionable findings.",
  findings: [],
  walkthroughMarkdown: "## Sovri review\n\nNo actionable findings.",
};

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

function isSuccessfulReviewAssembly(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Reflect.get(value, "llm_provider") === "test-provider" &&
    Reflect.get(value, "status") === "success" &&
    Reflect.has(value, "tokens_used")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
