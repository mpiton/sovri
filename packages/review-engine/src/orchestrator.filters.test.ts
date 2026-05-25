// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  ReviewSchema,
  type Category,
  type Diff,
  type PullRequest,
  type Review,
  type Severity,
} from "@sovri/core";
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
  readonly logger?: {
    info(fields: Record<string, unknown>, message: string): void;
  };
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

const preLlmDiff: Diff = {
  unified_diff: `diff --git a/src/app.ts b/src/app.ts
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
 old content
+enable review path
diff --git a/dist/app.js b/dist/app.js
index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644
--- a/dist/app.js
+++ b/dist/app.js
@@ -1 +1,2 @@
 old content
+generated bundle
diff --git a/coverage/summary.json b/coverage/summary.json
index 5555555555555555555555555555555555555555..6666666666666666666666666666666666666666 100644
--- a/coverage/summary.json
+++ b/coverage/summary.json
@@ -1 +1,2 @@
 {}
+generated coverage`,
  files: [
    {
      path: "src/app.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      sha: "2222222222222222222222222222222222222222",
      patch: "@@ -1 +1,2 @@\n old content\n+enable review path",
      hunks: [],
    },
    {
      path: "dist/app.js",
      status: "modified",
      additions: 1,
      deletions: 0,
      sha: "4444444444444444444444444444444444444444",
      patch: "@@ -1 +1,2 @@\n old content\n+generated bundle",
      hunks: [],
    },
    {
      path: "coverage/summary.json",
      status: "added",
      additions: 1,
      deletions: 0,
      sha: "6666666666666666666666666666666666666666",
      patch: "@@ -1 +1,2 @@\n {}\n+generated coverage",
      hunks: [],
    },
  ],
};

const preLlmPullRequest: PullRequest = {
  ...pullRequest,
  additions: 3,
  deletions: 0,
  changed_files: 3,
};

const preLlmConfig: ReviewFilterConfig = {
  review: {
    severityThreshold: "minor",
  },
  ignores: ["dist/**", "coverage/**"],
  limits: {
    maxFilesPerReview: 10,
    maxLinesPerReview: 500,
  },
};

describe("reviewPullRequest config filters", () => {
  it("removes ignored files from the prompt before the provider call", async () => {
    let providerCallCount = 0;
    let recordedUserPrompt = "";
    const provider = createProvider([]);
    const recordingProvider: LLMProvider = {
      ...provider,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        providerCallCount += 1;
        recordedUserPrompt = params.userPrompt;
        return provider.generateStructured(params);
      },
    };
    const reviewPullRequest = getReviewPullRequest();

    // Given the ReviewConfig ignores are ["dist/**", "coverage/**"]
    // And the provider records the user prompt it receives
    // When reviewPullRequest runs
    await reviewPullRequest(
      { pullRequest: preLlmPullRequest, diff: preLlmDiff, config: preLlmConfig },
      { provider: recordingProvider },
    );

    // Then the provider is called exactly 1 time
    expect(providerCallCount).toBe(1);
    // And the recorded user prompt contains "src/app.ts"
    expect(recordedUserPrompt).toContain("src/app.ts");
    // And the recorded user prompt does not contain "dist/app.js"
    expect(recordedUserPrompt).not.toContain("dist/app.js");
    // And the recorded user prompt does not contain "coverage/summary.json"
    expect(recordedUserPrompt).not.toContain("coverage/summary.json");
  });

  it("keeps every path in the provider prompt when ignores are empty", async () => {
    let providerCallCount = 0;
    let recordedUserPrompt = "";
    const provider = createProvider([]);
    const recordingProvider: LLMProvider = {
      ...provider,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        providerCallCount += 1;
        recordedUserPrompt = params.userPrompt;
        return provider.generateStructured(params);
      },
    };
    const reviewPullRequest = getReviewPullRequest();

    // Given the ReviewConfig ignores are []
    // And the provider records the user prompt it receives
    // When reviewPullRequest runs
    await reviewPullRequest(
      {
        pullRequest: preLlmPullRequest,
        diff: preLlmDiff,
        config: { ...preLlmConfig, ignores: [] },
      },
      { provider: recordingProvider },
    );

    // Then the provider is called exactly 1 time
    expect(providerCallCount).toBe(1);
    // And the recorded user prompt contains "src/app.ts"
    expect(recordedUserPrompt).toContain("src/app.ts");
    // And the recorded user prompt contains "dist/app.js"
    expect(recordedUserPrompt).toContain("dist/app.js");
    // And the recorded user prompt contains "generated bundle"
    expect(recordedUserPrompt).toContain("generated bundle");
  });

  it("returns a clean no-review result when ignore filters remove every file", async () => {
    let providerCallCount = 0;
    const provider = createProvider([]);
    const countingProvider: LLMProvider = {
      ...provider,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        providerCallCount += 1;
        return provider.generateStructured(params);
      },
    };
    const reviewPullRequest = getReviewPullRequest();

    // Given the ReviewConfig ignores are ["**"]
    // When reviewPullRequest runs
    const review = await reviewPullRequest(
      {
        pullRequest: preLlmPullRequest,
        diff: preLlmDiff,
        config: { ...preLlmConfig, ignores: ["**"] },
      },
      { provider: countingProvider },
    );

    // Then the provider is not called
    expect(providerCallCount).toBe(0);
    // And the returned Review status is "success"
    expect(review.status).toBe("success");
    // And the returned Review summary is "No files to review after ignore filters applied"
    expect(review.summary).toBe("No files to review after ignore filters applied");
    // And the returned walkthrough markdown contains "No files to review after ignore filters applied"
    expect(review.walkthrough_markdown).toContain(
      "No files to review after ignore filters applied",
    );
    // And the returned Review contains no findings
    expect(review.findings).toHaveLength(0);
    // And the returned token usage is 0 prompt tokens and 0 completion tokens
    expect(review.tokens_used).toEqual({ prompt: 0, completion: 0 });
    // And the returned Review has no reported provider token usage
    expect(Reflect.get(review, "token_usage_reported")).toBe(false);
    // And the returned Review error is absent
    expect(review.error).toBeUndefined();
  });

  it("logs changed, reviewable, and ignored file counts without raw patch content", async () => {
    const infoLogs: Array<{
      readonly fields: Record<string, unknown>;
      readonly message: string;
    }> = [];
    const logger = {
      info(fields: Record<string, unknown>, message: string): void {
        infoLogs.push({ fields, message });
      },
    };
    const provider = createProvider([]);
    const reviewPullRequest = getReviewPullRequest();

    // Given a logger stub records structured info events
    // And the ReviewConfig ignores are ["dist/**", "coverage/**"]
    // When reviewPullRequest runs
    await reviewPullRequest(
      { pullRequest: preLlmPullRequest, diff: preLlmDiff, config: preLlmConfig },
      { provider, logger },
    );

    const filterLog = infoLogs.find(
      (entry) => entry.message === "Review engine ignore filters applied",
    );
    const serializedLogs = JSON.stringify(infoLogs);

    // Then an info log message is emitted for "Review engine ignore filters applied"
    expect(filterLog).toBeDefined();
    // And the log fields include "changed_files" as 3
    expect(filterLog?.fields.changed_files).toBe(3);
    // And the log fields include "reviewable_files" as 1
    expect(filterLog?.fields.reviewable_files).toBe(1);
    // And the log fields include "ignored_files" as 2
    expect(filterLog?.fields.ignored_files).toBe(2);
    // And no logger event contains "generated bundle"
    expect(serializedLogs).not.toContain("generated bundle");
    // And no logger event contains "generated coverage"
    expect(serializedLogs).not.toContain("generated coverage");
  });

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

  it("normalizes Windows-style backslash separators before ignored path filtering", async () => {
    const provider = createProvider([
      providerFinding("major", "docs\\notes.md", 3, "Ignored doc finding"),
    ]);
    const reviewPullRequest = getReviewPullRequest();

    const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

    expect(review.findings).toHaveLength(0);
  });

  it("keeps findings whose repository path merely contains an ignore-rule prefix", async () => {
    const prefixConfig: ReviewFilterConfig = {
      ...config,
      ignores: ["src/**"],
    };
    const provider = createProvider([
      providerFinding(
        "major",
        "packages/review-engine/src/orchestrator.ts",
        18,
        "Mid-path prefix finding",
      ),
    ]);
    const reviewPullRequest = getReviewPullRequest();

    const review = await reviewPullRequest(
      { pullRequest, diff, config: prefixConfig },
      { provider },
    );

    expect(review.findings.map((finding) => finding.title)).toContain("Mid-path prefix finding");
    expect(review.findings.map((finding) => finding.file)).toContain(
      "packages/review-engine/src/orchestrator.ts",
    );
  });

  it("drops findings below the configured threshold", async () => {
    const reviewPullRequest = getReviewPullRequest();
    const oneFilePullRequest: PullRequest = {
      ...pullRequest,
      additions: 6,
      deletions: 1,
      changed_files: 1,
    };
    const oneFileDiff: Diff = {
      unified_diff: diff.unified_diff,
      files: [
        {
          path: "packages/review-engine/src/orchestrator.ts",
          status: "modified",
          additions: 6,
          deletions: 1,
          sha: "cccccccccccccccccccccccccccccccccccccccc",
          patch: "@@ -15,0 +16,2 @@",
          hunks: [],
        },
      ],
    };
    const examples: ReadonlyArray<{ readonly severity: Severity; readonly title: string }> = [
      { severity: "minor", title: "Minor naming issue" },
      { severity: "info", title: "Informational note" },
      { severity: "nitpick", title: "Nitpick wording" },
    ];

    await Promise.all(
      examples.map(async ({ severity, title }) => {
        let providerCallCount = 0;
        const provider = createProvider([
          providerFinding(severity, "packages/review-engine/src/orchestrator.ts", 18, title),
        ]);
        const countingProvider: LLMProvider = {
          ...provider,
          async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
            providerCallCount += 1;
            return provider.generateStructured(params);
          },
        };

        // Given the pull request changes 1 file
        // And the pull request has 6 additions and 1 deletion
        // And the provider returns one <severity> finding titled <title>
        // When the maintainer calls `reviewPullRequest`
        const review = await reviewPullRequest(
          { pullRequest: oneFilePullRequest, diff: oneFileDiff, config },
          { provider: countingProvider },
        );

        // Then the provider is called exactly 1 time
        expect(providerCallCount).toBe(1);
        // And the returned Review contains 0 findings
        expect(review.findings).toHaveLength(0);
        // And the returned Review status is "success"
        expect(review.status).toBe("success");
      }),
    );
  });

  it("drops ignored paths after parsing", async () => {
    const reviewPullRequest = getReviewPullRequest();
    const oneFilePullRequest: PullRequest = {
      ...pullRequest,
      additions: 6,
      deletions: 1,
      changed_files: 1,
    };
    const oneFileDiff: Diff = {
      unified_diff: diff.unified_diff,
      files: [
        {
          path: "packages/review-engine/src/orchestrator.ts",
          status: "modified",
          additions: 6,
          deletions: 1,
          sha: "cccccccccccccccccccccccccccccccccccccccc",
          patch: "@@ -15,0 +16,2 @@",
          hunks: [],
        },
      ],
    };
    const examples: ReadonlyArray<{
      readonly file: string;
      readonly title: string;
      readonly findingCount: number;
    }> = [
      { file: "docs/notes.md", title: "Ignored doc finding", findingCount: 0 },
      {
        file: "packages/review-engine/src/orchestrator.ts",
        title: "Kept orchestrator issue",
        findingCount: 1,
      },
    ];

    await Promise.all(
      examples.map(async ({ file, title, findingCount }) => {
        let providerCallCount = 0;
        const provider = createProvider([providerFinding("major", file, 18, title)]);
        const countingProvider: LLMProvider = {
          ...provider,
          async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
            providerCallCount += 1;
            return provider.generateStructured(params);
          },
        };

        // Given the pull request changes 1 file
        // And the pull request has 6 additions and 1 deletion
        // And the provider returns one "major" finding for file <file> titled <title>
        // When the maintainer calls `reviewPullRequest`
        const review = await reviewPullRequest(
          { pullRequest: oneFilePullRequest, diff: oneFileDiff, config },
          { provider: countingProvider },
        );

        // Then the provider is called exactly 1 time
        expect(providerCallCount).toBe(1);
        // And the returned Review contains <findingCount> findings
        expect(review.findings).toHaveLength(findingCount);
      }),
    );
  });

  it("treats the file count limit as inclusive before the provider call", async () => {
    const reviewPullRequest = getReviewPullRequest();
    const examples: ReadonlyArray<{
      readonly changedFiles: number;
      readonly providerCalls: number;
      readonly status: Review["status"];
    }> = [
      { changedFiles: 2, providerCalls: 1, status: "success" },
      { changedFiles: 3, providerCalls: 0, status: "failed" },
    ];

    await Promise.all(
      examples.map(async ({ changedFiles, providerCalls, status }) => {
        let providerCallCount = 0;
        const provider = createProvider([]);
        const countingProvider: LLMProvider = {
          ...provider,
          async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
            providerCallCount += 1;
            return provider.generateStructured(params);
          },
        };
        const inputPullRequest: PullRequest = {
          ...pullRequest,
          additions: 10,
          deletions: 2,
          changed_files: changedFiles,
        };

        // Given the pull request changes <changedFiles> files
        // And the pull request has 10 additions and 2 deletions
        // When the maintainer calls `reviewPullRequest`
        const review = await reviewPullRequest(
          { pullRequest: inputPullRequest, diff, config },
          { provider: countingProvider },
        );

        // Then the provider call count is <providerCalls>
        expect(providerCallCount).toBe(providerCalls);
        // And the returned Review status is <status>
        expect(review.status).toBe(status);
      }),
    );
  });

  it("treats the changed-line limit as inclusive before the provider call", async () => {
    const reviewPullRequest = getReviewPullRequest();
    const examples: ReadonlyArray<{
      readonly additions: number;
      readonly deletions: number;
      readonly providerCalls: number;
      readonly status: Review["status"];
    }> = [
      { additions: 20, deletions: 5, providerCalls: 1, status: "success" },
      { additions: 20, deletions: 6, providerCalls: 0, status: "failed" },
    ];

    await Promise.all(
      examples.map(async ({ additions, deletions, providerCalls, status }) => {
        let providerCallCount = 0;
        const provider = createProvider([]);
        const countingProvider: LLMProvider = {
          ...provider,
          async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
            providerCallCount += 1;
            return provider.generateStructured(params);
          },
        };
        const inputPullRequest: PullRequest = {
          ...pullRequest,
          additions,
          deletions,
          changed_files: 1,
        };

        // Given the pull request changes 1 file
        // And the pull request has <additions> additions and <deletions> deletions
        // When the maintainer calls `reviewPullRequest`
        const review = await reviewPullRequest(
          { pullRequest: inputPullRequest, diff, config },
          { provider: countingProvider },
        );

        // Then the provider call count is <providerCalls>
        expect(providerCallCount).toBe(providerCalls);
        // And the returned Review status is <status>
        expect(review.status).toBe(status);
      }),
    );
  });

  it("returns a schema-valid failed Review when a pre-LLM limit skips the provider", async () => {
    let providerCallCount = 0;
    const provider = createProvider([]);
    const countingProvider: LLMProvider = {
      ...provider,
      async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
        providerCallCount += 1;
        return provider.generateStructured(params);
      },
    };
    const overLimitPullRequest: PullRequest = {
      ...pullRequest,
      additions: 12,
      deletions: 4,
      changed_files: 3,
    };
    const reviewPullRequest = getReviewPullRequest();

    // Given the pull request changes 3 files
    // And the review config has `maxFilesPerReview` set to 2
    expect(config.limits.maxFilesPerReview).toBe(2);
    // And the pull request has 12 additions and 4 deletions
    // When the maintainer calls `reviewPullRequest`
    const review = await reviewPullRequest(
      { pullRequest: overLimitPullRequest, diff, config },
      { provider: countingProvider },
    );

    // Then the provider is called exactly 0 times
    expect(providerCallCount).toBe(0);
    // And the returned Review validates against `ReviewSchema`
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    // And the returned Review status is "failed"
    expect(review.status).toBe("failed");
    // And the returned Review `tokens_used` is 0 prompt tokens and 0 completion tokens
    expect(review.tokens_used).toEqual({ prompt: 0, completion: 0 });
    // And the returned Review has no reported provider token usage
    expect(Reflect.get(review, "token_usage_reported")).toBe(false);
    // And the returned Review summary contains "exceeds review limits"
    expect(review.summary).toContain("exceeds review limits");
    // And the returned Review error contains "exceeds review limits"
    expect(review.error).toContain("exceeds review limits");
  });
});
