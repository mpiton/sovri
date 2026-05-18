// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Category, Diff, PullRequest, Review, Severity } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { describe, expect, it } from "vitest";

import * as orchestrator from "./orchestrator.js";
import type { ProviderFinding } from "./parsing/index.js";

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

interface ReviewPullRequestInput {
  readonly pullRequest: PullRequest;
  readonly diff: Diff;
  readonly config: ReviewFilterConfig;
}

interface ReviewPullRequestOptions {
  readonly provider: LLMProvider;
}

type ReviewPullRequest = (
  input: ReviewPullRequestInput,
  options: ReviewPullRequestOptions,
) => Promise<Review>;

function isReviewPullRequest(candidate: unknown): candidate is ReviewPullRequest {
  return typeof candidate === "function";
}

function getReviewPullRequest(): ReviewPullRequest {
  const candidate: unknown = Reflect.get(orchestrator, "reviewPullRequest");

  expect(isReviewPullRequest(candidate)).toBe(true);

  if (!isReviewPullRequest(candidate)) {
    throw new TypeError("reviewPullRequest is not exported");
  }

  return candidate;
}

function createProvider(findings: readonly ProviderFinding[]): LLMProvider {
  return {
    name: "test-provider",
    model: "test-model",
    maxTokens: 2048,
    async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
      return params.schema.parse({
        summary: "Review completed.",
        findings,
        walkthrough_markdown: "## Sovri review\n\nReview completed.",
      });
    },
  };
}

function providerFinding(
  severity: Severity,
  file: string,
  lineStart: number,
  title: string,
  category: Category = "bug",
  confidence = 0.87,
): ProviderFinding {
  return {
    severity,
    category,
    file,
    line_start: lineStart,
    line_end: lineStart,
    title,
    body: `${title} body.`,
    confidence,
  };
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
  additions: 12,
  deletions: 4,
  changed_files: 2,
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
      additions: 8,
      deletions: 2,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
      patch: "@@ -15,0 +16,2 @@",
      hunks: [],
    },
    {
      path: "packages/review-engine/src/parsing/retry.ts",
      status: "modified",
      additions: 4,
      deletions: 2,
      sha: "dddddddddddddddddddddddddddddddddddddddd",
      patch: "@@ -20,0 +21,1 @@",
      hunks: [],
    },
  ],
};

const config: ReviewFilterConfig = {
  review: {
    severityThreshold: "major",
  },
  ignores: ["docs/**"],
  limits: {
    maxFilesPerReview: 2,
    maxLinesPerReview: 25,
  },
};

describe("reviewPullRequest config filters", () => {
  it("filters parsed findings by severity threshold and ignored paths", async () => {
    let providerCallCount = 0;
    const provider = createProvider([
      providerFinding(
        "blocker",
        "packages/review-engine/src/orchestrator.ts",
        18,
        "Missing hard limit",
      ),
      providerFinding(
        "major",
        "packages/review-engine/src/parsing/retry.ts",
        24,
        "Retry status mismatch",
      ),
      providerFinding(
        "minor",
        "packages/review-engine/src/walkthrough/index.ts",
        12,
        "Weak wording",
      ),
      providerFinding(
        "info",
        "packages/review-engine/src/orchestrator.ts",
        30,
        "Informational note",
      ),
      providerFinding(
        "nitpick",
        "packages/review-engine/src/orchestrator.ts",
        31,
        "Nitpick wording",
      ),
      providerFinding("major", "docs/notes.md", 3, "Ignored doc finding"),
    ]);
    const countingProvider: LLMProvider = {
      ...provider,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        providerCallCount += 1;
        return provider.generateStructured(params);
      },
    };
    const reviewPullRequest = getReviewPullRequest();

    // Given the pull request changes 2 files
    // And the pull request has 12 additions and 4 deletions
    // And the provider returns these findings:
    // When the maintainer calls `reviewPullRequest`
    const review = await reviewPullRequest(
      { pullRequest, diff, config },
      { provider: countingProvider },
    );

    const titles = review.findings.map((finding) => finding.title);

    // Then the provider is called exactly 1 time
    expect(providerCallCount).toBe(1);
    // And the returned Review contains 2 findings
    expect(review.findings).toHaveLength(2);
    // And the returned findings include "Missing hard limit"
    expect(titles).toContain("Missing hard limit");
    // And the returned findings include "Retry status mismatch"
    expect(titles).toContain("Retry status mismatch");
    // And the returned findings do not include "Weak wording"
    expect(titles).not.toContain("Weak wording");
    // And the returned findings do not include "Informational note"
    expect(titles).not.toContain("Informational note");
    // And the returned findings do not include "Nitpick wording"
    expect(titles).not.toContain("Nitpick wording");
    // And the returned findings do not include "Ignored doc finding"
    expect(titles).not.toContain("Ignored doc finding");
  });

  it("normalizes Windows provider paths before ignored path filtering", async () => {
    const provider = createProvider([
      providerFinding("major", "C:\\repo\\docs\\notes.md", 3, "Ignored doc finding"),
    ]);
    const reviewPullRequest = getReviewPullRequest();

    const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

    expect(review.findings).toHaveLength(0);
  });
});
