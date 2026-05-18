// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z, type PullRequest } from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./diff/index.js";
import { reviewPullRequest } from "./orchestrator.js";
import { buildInlineComments } from "./walkthrough/index.js";

const ProviderUrl = "https://llm.test/v1/messages";

const TokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => server.resetHandlers());

afterAll(() => server.close());

describe("reviewPullRequest MSW integration paths", () => {
  it("returns a successful Review with walkthrough and inline comments on the happy path", async () => {
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        return HttpResponse.json({
          data: {
            summary: "Review completed.",
            findings: [
              {
                severity: "major",
                category: "bug",
                file: "packages/review-engine/src/orchestrator.ts",
                line_start: 42,
                line_end: 42,
                title: "Missing error guard",
                body: "Guard this path before returning the review.",
                confidence: 0.91,
              },
            ],
            walkthrough_markdown: "## Sovri review\n\nReview completed.",
          },
          tokenUsage: { prompt: 812, completion: 144 },
        });
      }),
    );
    const provider = createHttpProvider();
    const diff = parseUnifiedDiff(unifiedDiff);

    // Given MSW returns a valid provider response with summary "Review completed."
    // And MSW returns one "major" finding on line 42
    // And MSW returns 812 prompt tokens and 144 completion tokens
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 1 provider request is observed by MSW
    expect(observedProviderRequests).toBe(1);
    // And the returned Review status is "success"
    expect(review.status).toBe("success");
    // And the returned Review contains 1 finding
    expect(review.findings).toHaveLength(1);
    // And the returned Review has non-empty `walkthrough_markdown`
    expect(review.walkthrough_markdown.length).toBeGreaterThan(0);

    // And deriving inline comments from the returned Review findings and parsed diff produces 1 inline comment draft
    const inlineComments = buildInlineComments(review.findings, diff);
    expect(inlineComments).toHaveLength(1);
    // And the inline comment draft path is "packages/review-engine/src/orchestrator.ts"
    // And the inline comment draft line is 42
    expect(inlineComments).toEqual([
      expect.objectContaining({
        path: "packages/review-engine/src/orchestrator.ts",
        line: 42,
      }),
    ]);
  });

  it("retries a schema-invalid first response and returns a partial Review", async () => {
    let observedProviderRequests = 0;
    server.use(
      http.post(ProviderUrl, () => {
        observedProviderRequests += 1;

        if (observedProviderRequests === 1) {
          return HttpResponse.json({
            data: {
              summary: 42,
              findings: [],
              walkthrough_markdown: "## Sovri review\n\nInvalid review.",
            },
            tokenUsage: { prompt: 600, completion: 120 },
          });
        }

        return HttpResponse.json({
          data: {
            summary: "Corrected review.",
            findings: [],
            walkthrough_markdown: "## Sovri review\n\nCorrected review.",
          },
          tokenUsage: { prompt: 300, completion: 80 },
        });
      }),
    );
    const provider = createHttpProvider();
    const diff = parseUnifiedDiff(unifiedDiff);

    // Given MSW first returns schema-invalid provider JSON
    // And MSW then returns a valid provider response with summary "Corrected review."
    // And MSW returns total usage of 900 prompt tokens and 200 completion tokens
    // When the integration test calls `reviewPullRequest`
    const review = await reviewPullRequest(
      {
        pullRequest,
        diff,
        config: {
          review: { severityThreshold: "major" },
          ignores: [],
          limits: {
            maxFilesPerReview: 5,
            maxLinesPerReview: 50,
          },
        },
      },
      { provider },
    );

    // Then exactly 2 provider requests are observed by MSW
    expect(observedProviderRequests).toBe(2);
    // And the returned Review status is "partial"
    expect(review.status).toBe("partial");
    // And no returned finding is titled "review_failed"
    expect(review.findings.some((finding) => finding.title === "review_failed")).toBe(false);
    // And the returned Review `tokens_used.prompt` is 900
    expect(review.tokens_used.prompt).toBe(900);
  });
});

function createHttpProvider(): LLMProvider {
  const model = "test-model";

  return {
    name: "msw-provider",
    model,
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      const generation = await generateHttpStructured(params, model);

      return generation.data;
    },
    async generateStructuredWithUsage<T>(
      params: GenerateStructuredParams<T>,
    ): Promise<StructuredGeneration<T>> {
      return generateHttpStructured(params, model);
    },
  };
}

async function generateHttpStructured<T>(
  params: GenerateStructuredParams<T>,
  model: string,
): Promise<StructuredGeneration<T>> {
  const response = await fetch(ProviderUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      maxTokens: params.maxTokens,
      model,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
    }),
  });
  const body: unknown = await response.json();
  const parsed = createProviderHttpResponseSchema<T>().parse(body);

  return {
    data: parsed.data,
    tokenUsage: parsed.tokenUsage,
  };
}

function createProviderHttpResponseSchema<T>() {
  return z.object({
    data: z.custom<T>(),
    tokenUsage: TokenUsageSchema,
  });
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
  additions: 1,
  deletions: 1,
  changed_files: 1,
};

const unifiedDiff = `diff --git a/packages/review-engine/src/orchestrator.ts b/packages/review-engine/src/orchestrator.ts
index 1111111..2222222 100644
--- a/packages/review-engine/src/orchestrator.ts
+++ b/packages/review-engine/src/orchestrator.ts
@@ -40,3 +40,3 @@ export async function reviewPullRequest()
 const startedAt = new Date();
-const review = await runReview(input, options);
+const review = await generateParsedProviderReview(options.provider, params);
 return review;
`;
