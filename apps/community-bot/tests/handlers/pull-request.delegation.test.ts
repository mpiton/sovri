// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import type { SovriConfig } from "@sovri/config";
import type { Diff, Review } from "@sovri/review-engine";
import {
  handlePullRequestOpened,
  handlePullRequestSynchronize,
  type PullRequestHandlerDependencies,
  type PullRequestWebhookContext,
} from "../../src/handlers/pull-request.js";

const REPO_FULL_NAME = "mpiton/sovri";
const OPENED_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SYNCHRONIZED_HEAD_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("pull request handlers - ATDD #477", () => {
  it.each([
    {
      event: "pull_request.opened",
      handler: handlePullRequestOpened,
      handlerName: "handlePullRequestOpened",
      headSha: OPENED_HEAD_SHA,
    },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      handlerName: "handlePullRequestSynchronize",
      headSha: SYNCHRONIZED_HEAD_SHA,
    },
  ])(
    "$handlerName delegates every review step to collaborators",
    async ({ event, handler, headSha }) => {
      const config = buildConfig({ autoReviewDrafts: false });
      const diff = buildDiff();
      const review = buildReview({ commitSha: headSha });
      const dependencies = buildDependencies({ config, diff, review });
      const context = buildContext({ event, headSha });

      // Given the config loader returns `autoReviewDrafts: false`
      expect(config.review.autoReviewDrafts).toBe(false);
      // And the diff fetcher returns a unified diff for file "apps/community-bot/src/handlers/pull-request.ts"
      expect(diff.files[0]?.path).toBe("apps/community-bot/src/handlers/pull-request.ts");
      // And the review engine returns a review with 1 finding
      expect(review.findings).toHaveLength(1);

      // When `<handler>` handles the `<event>` webhook for pull request 41
      await handler(context, dependencies);

      // Then the handler calls the config loader exactly 1 time
      expect(dependencies.loadConfig).toHaveBeenCalledTimes(1);
      // And the handler calls the diff fetcher exactly 1 time
      expect(dependencies.fetchDiff).toHaveBeenCalledTimes(1);
      // And the handler calls the review engine exactly 1 time
      expect(dependencies.reviewPullRequest).toHaveBeenCalledTimes(1);
      // And the handler calls the review poster exactly 1 time
      expect(dependencies.postReview).toHaveBeenCalledTimes(1);
      // And the review engine receives head SHA "<head_sha>"
      expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequest: expect.objectContaining({ head_sha: headSha }),
        }),
        expect.any(Object),
      );
      // And the handler does not compute findings itself
      expect(dependencies.postReview).toHaveBeenCalledWith(
        expect.objectContaining({ number: 41, repoFullName: REPO_FULL_NAME }),
        review,
      );
    },
  );
});

function buildDependencies(values: {
  readonly config: SovriConfig;
  readonly diff: Diff;
  readonly review: Review;
}): PullRequestHandlerDependencies {
  return {
    fetchDiff: vi.fn().mockResolvedValue(values.diff),
    loadConfig: vi.fn().mockResolvedValue(values.config),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    postErrorComment: vi.fn(),
    postReview: vi.fn(),
    reviewPullRequest: vi.fn().mockResolvedValue(values.review),
  };
}

function buildConfig(values: { readonly autoReviewDrafts: boolean }): SovriConfig {
  return {
    ignores: [],
    limits: {
      maxFilesPerReview: 50,
      maxLinesPerReview: 5000,
    },
    llm: {
      apiKeySecret: "ANTHROPIC_API_KEY",
      model: "claude-3-5-sonnet-latest",
      provider: "anthropic",
    },
    review: {
      autoReviewDrafts: values.autoReviewDrafts,
      mode: "full",
      severityThreshold: "minor",
    },
  };
}

function buildContext(values: {
  readonly event: string;
  readonly headSha: string;
}): PullRequestWebhookContext {
  return {
    id: "8f1b9c2d-3e4f-45a6-91b2-123456789abc",
    name: values.event,
    octokit: {},
    payload: {
      action: values.event === "pull_request.opened" ? "opened" : "synchronize",
      pull_request: {
        additions: 12,
        base: {
          ref: "main",
          sha: "dddddddddddddddddddddddddddddddddddddddd",
        },
        body: "Implement pull request handlers.",
        changed_files: 1,
        deletions: 3,
        draft: false,
        head: {
          ref: "task-41",
          sha: values.headSha,
        },
        number: 41,
        title: "Implement handlers/pull-request.ts",
        user: {
          login: "octocat",
        },
      },
      repository: {
        full_name: REPO_FULL_NAME,
      },
    },
  };
}

function buildDiff(): Diff {
  return {
    files: [
      {
        additions: 12,
        deletions: 3,
        hunks: [],
        patch: '@@ -1,1 +1,2 @@\n import type { Probot } from "probot";\n+export {}',
        path: "apps/community-bot/src/handlers/pull-request.ts",
        sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        status: "modified",
      },
    ],
    unified_diff:
      "diff --git a/apps/community-bot/src/handlers/pull-request.ts b/apps/community-bot/src/handlers/pull-request.ts",
  };
}

function buildReview(values: { readonly commitSha: string }): Review {
  return {
    completed_at: new Date("2026-05-18T10:00:01.000Z"),
    commit_sha: values.commitSha,
    findings: [
      {
        body: "The handler should delegate review work.",
        category: "maintainability",
        confidence: 0.95,
        file: "apps/community-bot/src/handlers/pull-request.ts",
        id: "123e4567-e89b-42d3-a456-426614174000",
        line_end: 42,
        line_start: 42,
        severity: "major",
        source: "llm",
        title: "Delegation check",
      },
    ],
    id: "123e4567-e89b-42d3-a456-426614174001",
    llm_model: "test-model",
    llm_provider: "test-provider",
    pr_number: 41,
    repo_full_name: REPO_FULL_NAME,
    started_at: new Date("2026-05-18T10:00:00.000Z"),
    status: "success",
    summary: "Review complete",
    tokens_used: {
      completion: 20,
      prompt: 100,
    },
    walkthrough_markdown: "Review complete",
  };
}
