// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff, PullRequest } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { afterEach, describe, expect, it, vi } from "vitest";

interface ReviewPullRequestConfig {
  readonly review: {
    readonly severityThreshold: "major";
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
  readonly config: ReviewPullRequestConfig;
}

type ReviewPullRequestRuntime = (
  input: ReviewPullRequestInput,
  options: unknown,
) => Promise<unknown>;

const sentinels = vi.hoisted(() => ({
  filesystemReads: 0,
}));

vi.mock("node:fs", () => {
  const triggerFilesystemRead = () => {
    sentinels.filesystemReads += 1;
    throw new Error("filesystem sentinel triggered");
  };

  return {
    existsSync: triggerFilesystemRead,
    readFile: triggerFilesystemRead,
    readFileSync: triggerFilesystemRead,
  };
});

vi.mock("node:fs/promises", () => {
  const triggerFilesystemRead = () => {
    sentinels.filesystemReads += 1;
    throw new Error("filesystem sentinel triggered");
  };

  return {
    readFile: triggerFilesystemRead,
  };
});

afterEach(() => {
  sentinels.filesystemReads = 0;
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("reviewPullRequest injected-provider I/O boundary", () => {
  it("only calls the injected provider during a normal review", async () => {
    const provider = new CountingProvider();
    let environmentReads = 0;
    let countReviewEnvironmentReads = false;
    let rawNetworkCalls = 0;
    let githubApiCalls = 0;
    const triggerGithubApiCall = () => {
      githubApiCalls += 1;
      throw new Error("GitHub API sentinel triggered");
    };

    vi.stubGlobal("fetch", () => {
      rawNetworkCalls += 1;
      throw new Error("raw network sentinel triggered");
    });
    vi.stubGlobal("GitHub", {
      graphql: triggerGithubApiCall,
      request: triggerGithubApiCall,
    });
    vi.stubGlobal(
      "Octokit",
      class GitHubApiSentinel {
        public readonly graphql = triggerGithubApiCall;
        public readonly request = triggerGithubApiCall;
      },
    );
    const restoreEnvironment = guardEnvironmentReads(() => {
      if (countReviewEnvironmentReads) {
        environmentReads += 1;
      }
    });

    try {
      const reviewPullRequest = await loadReviewPullRequest();

      // Given the provider returns a valid response with 0 findings
      // When the maintainer calls `reviewPullRequest`
      countReviewEnvironmentReads = true;
      await reviewPullRequest(
        {
          pullRequest,
          diff,
          config,
        },
        { provider },
      );
    } finally {
      countReviewEnvironmentReads = false;
      restoreEnvironment();
    }

    // Then the provider is called exactly 1 time
    expect(provider.calls).toBe(1);
    // And no filesystem sentinel is triggered
    expect(sentinels.filesystemReads).toBe(0);
    // And no environment sentinel is triggered
    expect(environmentReads).toBe(0);
    // And no raw network sentinel is triggered
    expect(rawNetworkCalls).toBe(0);
    // And no GitHub API sentinel is triggered
    expect(githubApiCalls).toBe(0);
  });

  it("fails input validation before review execution when provider is missing", async () => {
    let environmentReads = 0;
    let countReviewEnvironmentReads = false;
    let rawNetworkCalls = 0;

    vi.stubGlobal("fetch", () => {
      rawNetworkCalls += 1;
      throw new Error("raw network sentinel triggered");
    });
    const restoreEnvironment = guardEnvironmentReads(() => {
      if (countReviewEnvironmentReads) {
        environmentReads += 1;
      }
    });

    try {
      const reviewPullRequest = await loadReviewPullRequest();

      // Given no provider is injected
      // When the maintainer calls `reviewPullRequest`
      countReviewEnvironmentReads = true;
      const review = reviewPullRequest({ pullRequest, diff, config }, {});

      // Then input validation fails before review execution
      await expect(review).rejects.toThrow("reviewPullRequest requires an injected provider");
    } finally {
      countReviewEnvironmentReads = false;
      restoreEnvironment();
    }

    // And no default provider is created from environment variables
    expect(environmentReads).toBe(0);
    // And no filesystem sentinel is triggered
    expect(sentinels.filesystemReads).toBe(0);
    // And no raw network sentinel is triggered
    expect(rawNetworkCalls).toBe(0);
  });
});

class CountingProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    this.calls += 1;

    return params.schema.parse({
      summary: "Review completed.",
      findings: [],
      walkthrough_markdown: "## Sovri review\n\nReview completed.",
    });
  }
}

function guardEnvironmentReads(onRead: () => void): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, "env");
  const originalEnvironment = process.env;

  Object.defineProperty(process, "env", {
    configurable: true,
    enumerable: originalDescriptor?.enumerable ?? true,
    get() {
      onRead();

      return originalEnvironment;
    },
  });

  return () => {
    if (originalDescriptor === undefined) {
      Object.defineProperty(process, "env", {
        configurable: true,
        enumerable: true,
        value: originalEnvironment,
        writable: true,
      });
      return;
    }

    Object.defineProperty(process, "env", originalDescriptor);
  };
}

function isReviewPullRequestRuntime(value: unknown): value is ReviewPullRequestRuntime {
  return typeof value === "function";
}

async function loadReviewPullRequest(): Promise<ReviewPullRequestRuntime> {
  const orchestrator = await import("./orchestrator.js");
  const candidate: unknown = Reflect.get(orchestrator, "reviewPullRequest");

  expect(isReviewPullRequestRuntime(candidate)).toBe(true);

  if (!isReviewPullRequestRuntime(candidate)) {
    throw new TypeError("reviewPullRequest is not exported");
  }

  return candidate;
}

const config: ReviewPullRequestConfig = {
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
  title: "Implement orchestrator TypeScript review",
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
