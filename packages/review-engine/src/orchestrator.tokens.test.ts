// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z, type Diff, type PullRequest, type Severity } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import { reviewPullRequest } from "./orchestrator.js";

interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

interface StructuredGeneration<T> {
  readonly data: T;
  readonly tokenUsage: TokenUsage;
}

interface UsageAwareProvider extends LLMProvider {
  generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>>;
}

interface ProviderIssue {
  readonly path: readonly string[];
  readonly message: string;
}

class ProviderSchemaValidationError extends Error {
  readonly issues: readonly ProviderIssue[];
  readonly tokenUsage: TokenUsage;
  readonly retryableWithCorrectivePrompt = true;

  constructor(tokenUsage: TokenUsage) {
    super("Provider response failed schema validation");
    this.issues = [{ path: ["summary"], message: "Expected string" }];
    this.tokenUsage = tokenUsage;
  }
}

class ProviderProtocolError extends Error {
  readonly issues: readonly ProviderIssue[];

  constructor() {
    super("Provider usage metadata failed validation");
    this.issues = [{ path: ["usage", "input_tokens"], message: "Expected integer" }];
  }
}

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

function createUsageAwareProvider(tokenUsage: TokenUsage): UsageAwareProvider {
  const response = {
    summary: "Review completed.",
    findings: [],
    walkthrough_markdown: "## Sovri review\n\nReview completed.",
  };

  return {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      return params.schema.parse(response);
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      return {
        data: params.schema.parse(response),
        tokenUsage,
      };
    },
  };
}

function createSchemaInvalidThenValidProvider(): UsageAwareProvider {
  const response = {
    summary: "Corrected review.",
    findings: [],
    walkthrough_markdown: "## Sovri review\n\nCorrected review.",
  };
  let callCount = 0;
  const provider: UsageAwareProvider = {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      const generation = await provider.generateStructuredWithUsage(params);

      return generation.data;
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      callCount += 1;

      if (callCount === 1) {
        throw new ProviderSchemaValidationError({ prompt: 600, completion: 120 });
      }

      return {
        data: params.schema.parse(response),
        tokenUsage: { prompt: 300, completion: 80 },
      };
    },
  };

  return provider;
}

function createSchemaInvalidUsageThenValidProvider(): UsageAwareProvider {
  const response = {
    summary: "Corrected review.",
    findings: [],
    walkthrough_markdown: "## Sovri review\n\nCorrected review.",
  };
  let callCount = 0;
  const provider: UsageAwareProvider = {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      const generation = await provider.generateStructuredWithUsage(params);

      return generation.data;
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      callCount += 1;

      if (callCount === 1) {
        throw new ProviderSchemaValidationError({ prompt: -5, completion: 0 });
      }

      return {
        data: params.schema.parse(response),
        tokenUsage: { prompt: 10, completion: 0 },
      };
    },
  };

  return provider;
}

function createProtocolInvalidThenValidProvider(): UsageAwareProvider {
  const response = {
    summary: "Corrected review.",
    findings: [],
    walkthrough_markdown: "## Sovri review\n\nCorrected review.",
  };
  let callCount = 0;
  const provider: UsageAwareProvider = {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      const generation = await provider.generateStructuredWithUsage(params);

      return generation.data;
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      callCount += 1;

      if (callCount === 1) {
        throw new ProviderProtocolError();
      }

      return {
        data: params.schema.parse(response),
        tokenUsage: { prompt: 300, completion: 80 },
      };
    },
  };

  return provider;
}

const pullRequest: PullRequest = {
  number: 38,
  repo_full_name: "mpiton/sovri",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/review-orchestrator",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Implement orchestrator TypeScript review",
  body: "Wire parsing, filtering, and review output.",
  additions: 9,
  deletions: 2,
  changed_files: 1,
};

const diff: Diff = {
  unified_diff: `diff --git a/packages/review-engine/src/orchestrator.ts b/packages/review-engine/src/orchestrator.ts
@@ -15,0 +16,2 @@
+export async function reviewPullRequest() {
+}`,
  files: [
    {
      path: "packages/review-engine/src/orchestrator.ts",
      status: "modified",
      additions: 9,
      deletions: 2,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
      patch: "@@ -15,0 +16,2 @@",
      hunks: [],
    },
  ],
};

const config: ReviewFilterConfig = {
  review: {
    severityThreshold: "major",
  },
  ignores: [],
  limits: {
    maxFilesPerReview: 2,
    maxLinesPerReview: 25,
  },
};

describe("reviewPullRequest token usage", () => {
  it("copies token usage from a single provider response onto the Review", async () => {
    const examples: readonly TokenUsage[] = [
      { prompt: 812, completion: 144 },
      { prompt: 0, completion: 0 },
    ];

    await Promise.all(
      examples.map(async (tokenUsage) => {
        const provider = createUsageAwareProvider(tokenUsage);

        // Given the provider returns summary "Review completed."
        // And the provider returns 0 findings
        // And the provider reports <promptTokens> prompt tokens and <completionTokens> completion tokens
        // When the maintainer calls `reviewPullRequest`
        const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

        // Then the returned Review `tokens_used.prompt` is <promptTokens>
        expect(review.tokens_used.prompt).toBe(tokenUsage.prompt);
        // And the returned Review `tokens_used.completion` is <completionTokens>
        expect(review.tokens_used.completion).toBe(tokenUsage.completion);
        // And the returned Review marks token usage as provider-reported
        expect(Reflect.get(review, "token_usage_reported")).toBe(true);
      }),
    );
  });

  it("rejects invalid token usage before returning a Review", async () => {
    const provider = createUsageAwareProvider({ prompt: -1, completion: 144 });

    // Given the provider reports -1 prompt tokens and 144 completion tokens
    // When the maintainer calls `reviewPullRequest`
    const review = reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then validation fails against the token usage contract
    // And no invalid Review is returned
    await expect(review).rejects.toBeInstanceOf(z.ZodError);
  });

  it("accumulates token usage when a corrective retry succeeds", async () => {
    const provider = createSchemaInvalidThenValidProvider();

    // Given the first provider response is schema-invalid
    // And the first provider response reports 600 prompt tokens and 120 completion tokens
    // And the corrective provider response is valid
    // And the corrective provider response reports 300 prompt tokens and 80 completion tokens
    // When the maintainer calls `reviewPullRequest`
    const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then the returned Review status is "partial"
    expect(review.status).toBe("partial");
    // And the returned Review `tokens_used.prompt` is 900
    expect(review.tokens_used.prompt).toBe(900);
    // And the returned Review `tokens_used.completion` is 200
    expect(review.tokens_used.completion).toBe(200);
    // And the returned Review marks token usage as provider-reported
    expect(Reflect.get(review, "token_usage_reported")).toBe(true);
  });

  it("rejects invalid token usage from schema-invalid retry attempts", async () => {
    const provider = createSchemaInvalidUsageThenValidProvider();

    // Given the first provider response is schema-invalid
    // And the first provider response reports invalid token usage
    // And the corrective provider response reports enough valid tokens to mask the invalid usage
    // When the maintainer calls `reviewPullRequest`
    const review = reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then validation fails against the token usage contract
    // And no partial Review is returned
    await expect(review).rejects.toBeInstanceOf(z.ZodError);
  });

  it("does not retry provider protocol errors that expose issues", async () => {
    const provider = createProtocolInvalidThenValidProvider();

    // Given the first provider call fails while validating provider protocol metadata
    // And the provider error exposes validation issues
    // When the maintainer calls `reviewPullRequest`
    const review = reviewPullRequest({ pullRequest, diff, config }, { provider });

    // Then the protocol error is preserved
    // And no corrective retry returns a partial review
    await expect(review).rejects.toThrow("Provider usage metadata failed validation");
  });
});
