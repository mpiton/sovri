// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "@sovri/config";
import type { Diff, Review } from "@sovri/review-engine";

import {
  handleReReviewCommand,
  type ReReviewCommandDependencies,
  type ReReviewOctokit,
} from "../../../src/commands/handlers/re-review.js";
import type { IssueCommentCommandContext } from "../../../src/handlers/issue-comment.js";
import type { PullRequestHandlerDependencies } from "../../../src/handlers/pull-request.js";

const RepoFullName = "mpiton/sovri";
const DeliveryId = "delivery-re-review-lookup-failure";
const PullRequestNumber = 42;
const CommentId = 87654;
const BaseSha = "dddddddddddddddddddddddddddddddddddddddd";
const HeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("re-review command handler", () => {
  it.each([
    { failure: "GitHub lookup", mode: "rejects" },
    { failure: "pull request schema validation", mode: "invalid-response" },
  ])("posts one review failure comment for $failure failure", async ({ mode }) => {
    const runtime = buildRuntime(mode);

    await handleReReviewCommand(buildCommand(), runtime.dependencies);

    expect(runtime.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "mpiton",
      pull_number: PullRequestNumber,
      repo: "sovri",
    });
    expect(runtime.createPullRequestDependencies).toHaveBeenCalledTimes(1);
    expect(runtime.postErrorComment).toHaveBeenCalledWith(
      { number: PullRequestNumber, repoFullName: RepoFullName },
      "review failed",
    );
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: DeliveryId,
        event: "pull_request.synchronize",
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Pull request review failed",
    );
    expect(runtime.loadConfig).not.toHaveBeenCalled();
    expect(runtime.fetchDiff).not.toHaveBeenCalled();
    expect(runtime.reactToAccepted).not.toHaveBeenCalled();
    expect(runtime.reviewPullRequest).not.toHaveBeenCalled();
    expect(runtime.postReview).not.toHaveBeenCalled();
  });

  it("delegates successful pull request resolution to the synchronize handler", async () => {
    const runtime = buildRuntime("valid-response");

    await handleReReviewCommand(buildCommand(), runtime.dependencies);

    expect(runtime.reactToAccepted).toHaveBeenCalledWith({
      commentId: CommentId,
      content: "+1",
      repoFullName: RepoFullName,
    });
    assertCalledBefore(runtime.reactToAccepted, runtime.loadConfig);
    expect(runtime.loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        baseSha: BaseSha,
        commitSha: HeadSha,
        number: PullRequestNumber,
        repoFullName: RepoFullName,
      }),
    );
    expect(runtime.fetchDiff).toHaveBeenCalledTimes(1);
    expect(runtime.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: expect.objectContaining({
          head_sha: HeadSha,
          number: PullRequestNumber,
          repo_full_name: RepoFullName,
        }),
      }),
      expect.any(Object),
    );
    expect(runtime.postReview).toHaveBeenCalledTimes(1);
    expect(runtime.postErrorComment).not.toHaveBeenCalled();
  });

  it("continues the review flow when the accepted reaction fails", async () => {
    const runtime = buildRuntime("valid-response");
    runtime.reactToAccepted.mockRejectedValue(new Error("GitHub reaction API failed"));

    await handleReReviewCommand(buildCommand(), runtime.dependencies);

    expect(runtime.reactToAccepted).toHaveBeenCalledTimes(1);
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: DeliveryId,
        error_message: "GitHub reaction API failed",
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Accepted re-review reaction failed",
    );
    expect(runtime.loadConfig).toHaveBeenCalledTimes(1);
    expect(runtime.reviewPullRequest).toHaveBeenCalledTimes(1);
    expect(runtime.postReview).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      failingStep: "diff fetcher",
      postReviewCalls: 0,
      reject(runtime: ReReviewRuntime): void {
        runtime.fetchDiff.mockRejectedValue(new Error("provider timeout"));
      },
    },
    {
      failingStep: "review engine",
      postReviewCalls: 0,
      reject(runtime: ReReviewRuntime): void {
        runtime.reviewPullRequest.mockRejectedValue(new Error("provider timeout"));
      },
    },
    {
      failingStep: "review poster",
      postReviewCalls: 1,
      reject(runtime: ReReviewRuntime): void {
        runtime.postReview.mockRejectedValue(new Error("provider timeout"));
      },
    },
  ])("posts one review failure comment for shared $failingStep failure", async (testCase) => {
    const runtime = buildRuntime("valid-response");
    testCase.reject(runtime);

    await handleReReviewCommand(buildCommand(), runtime.dependencies);

    expect(runtime.reactToAccepted).toHaveBeenCalledTimes(1);
    expect(runtime.postErrorComment).toHaveBeenCalledTimes(1);
    expect(runtime.postErrorComment).toHaveBeenCalledWith(
      expect.objectContaining({ number: PullRequestNumber, repoFullName: RepoFullName }),
      "review failed",
    );
    expect(runtime.postReview).toHaveBeenCalledTimes(testCase.postReviewCalls);
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: DeliveryId,
        error_message: "provider timeout",
        event: "pull_request.synchronize",
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Pull request review failed",
    );
  });

  it("logs error comment posting failure without duplicate comments", async () => {
    const runtime = buildRuntime("valid-response");
    runtime.reviewPullRequest.mockRejectedValue(new Error("provider timeout"));
    runtime.postErrorComment.mockRejectedValue(new Error("GitHub comment API failed"));

    await handleReReviewCommand(
      buildCommand({ correlationId: "delivery-re-review-013" }),
      runtime.dependencies,
    );

    expect(runtime.postErrorComment).toHaveBeenCalledTimes(1);
    expect(runtime.postErrorComment).toHaveBeenCalledWith(
      expect.objectContaining({ number: PullRequestNumber, repoFullName: RepoFullName }),
      "review failed",
    );
    expect(runtime.postReview).not.toHaveBeenCalled();
    expect(runtime.logger.error).toHaveBeenCalledTimes(1);
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_error_message: "GitHub comment API failed",
        delivery_id: "delivery-re-review-013",
        error_message: "provider timeout",
        event: "pull_request.synchronize",
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Pull request review failed",
    );
  });

  it("logs draft skip without running review collaborators when draft reviews are disabled", async () => {
    const runtime = buildRuntime("valid-response", { draft: true });

    await handleReReviewCommand(
      buildCommand({ correlationId: "delivery-re-review-015" }),
      runtime.dependencies,
    );

    expect(runtime.loadConfig).toHaveBeenCalledTimes(1);
    expect(runtime.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: "delivery-re-review-015",
        draft: true,
        event: "pull_request.synchronize",
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Pull request review skipped",
    );
    expect(runtime.fetchDiff).not.toHaveBeenCalled();
    expect(runtime.reviewPullRequest).not.toHaveBeenCalled();
    expect(runtime.postReview).not.toHaveBeenCalled();
    expect(runtime.postErrorComment).not.toHaveBeenCalled();
  });
});

type RuntimeMode = "invalid-response" | "rejects" | "valid-response";
type ReReviewRuntime = ReturnType<typeof buildRuntime>;

function buildRuntime(
  mode: RuntimeMode,
  values: { readonly draft?: boolean } = {},
): {
  readonly createPullRequestDependencies: ReturnType<
    typeof vi.fn<ReReviewCommandDependencies["createPullRequestDependencies"]>
  >;
  readonly dependencies: ReReviewCommandDependencies;
  readonly fetchDiff: ReturnType<typeof vi.fn<PullRequestHandlerDependencies["fetchDiff"]>>;
  readonly loadConfig: ReturnType<typeof vi.fn<PullRequestHandlerDependencies["loadConfig"]>>;
  readonly logger: PullRequestHandlerDependencies["logger"];
  readonly octokit: ReReviewOctokit;
  readonly postErrorComment: ReturnType<
    typeof vi.fn<PullRequestHandlerDependencies["postErrorComment"]>
  >;
  readonly postReview: ReturnType<typeof vi.fn<PullRequestHandlerDependencies["postReview"]>>;
  readonly reactToAccepted: ReturnType<
    typeof vi.fn<ReReviewCommandDependencies["reactToAccepted"]>
  >;
  readonly reviewPullRequest: ReturnType<
    typeof vi.fn<PullRequestHandlerDependencies["reviewPullRequest"]>
  >;
} {
  const octokit = buildOctokit(mode, values);
  const fetchDiff = vi.fn<PullRequestHandlerDependencies["fetchDiff"]>(async () => buildDiff());
  const loadConfig = vi.fn<PullRequestHandlerDependencies["loadConfig"]>(
    async () => DEFAULT_CONFIG,
  );
  const postErrorComment = vi.fn<PullRequestHandlerDependencies["postErrorComment"]>(
    async () => undefined,
  );
  const postReview = vi.fn<PullRequestHandlerDependencies["postReview"]>(async () => undefined);
  const reactToAccepted = vi.fn<ReReviewCommandDependencies["reactToAccepted"]>(
    async () => undefined,
  );
  const reviewPullRequest = vi.fn<PullRequestHandlerDependencies["reviewPullRequest"]>(async () =>
    buildReview(),
  );
  const logger: PullRequestHandlerDependencies["logger"] = {
    error: vi.fn<PullRequestHandlerDependencies["logger"]["error"]>(() => undefined),
    info: vi.fn<PullRequestHandlerDependencies["logger"]["info"]>(() => undefined),
  };
  const pullRequestDependencies: PullRequestHandlerDependencies = {
    fetchDiff,
    loadConfig,
    logger,
    postErrorComment,
    postReview,
    reviewPullRequest,
  };
  const createPullRequestDependencies = vi.fn<
    ReReviewCommandDependencies["createPullRequestDependencies"]
  >(() => pullRequestDependencies);

  return {
    createPullRequestDependencies,
    dependencies: {
      createPullRequestDependencies,
      octokit,
      reactToAccepted,
    },
    fetchDiff,
    loadConfig,
    logger,
    octokit,
    postErrorComment,
    postReview,
    reactToAccepted,
    reviewPullRequest,
  };
}

function buildOctokit(mode: RuntimeMode, values: { readonly draft?: boolean }): ReReviewOctokit {
  const getPullRequest = vi.fn<ReReviewOctokit["rest"]["pulls"]["get"]>(async () => {
    if (mode === "rejects") {
      throw new Error("GitHub pull lookup failed");
    }

    return {
      data:
        mode === "invalid-response"
          ? { number: PullRequestNumber }
          : buildPullRequest({ draft: values.draft ?? false }),
    };
  });

  return {
    async request() {
      return { data: "" };
    },
    rest: {
      issues: {
        async createComment(parameters) {
          return { data: { body: parameters.body, id: CommentId } };
        },
        async deleteComment() {
          return { data: {} };
        },
        async listComments() {
          return { data: [] };
        },
        async updateComment(parameters) {
          return { data: { body: parameters.body, id: parameters.comment_id } };
        },
      },
      pulls: {
        async createReview(parameters) {
          return { data: { body: parameters.body, id: 98765 } };
        },
        async createReviewComment() {
          return { data: { id: 98766 } };
        },
        get: getPullRequest,
        async listFiles() {
          return { data: [] };
        },
        async listReviews() {
          return { data: [] };
        },
        async updateReview(parameters) {
          return { data: { body: parameters.body, id: parameters.review_id } };
        },
      },
      repos: {
        async getContent() {
          return { data: "" };
        },
      },
      reactions: {
        async createForIssueComment(parameters) {
          return { data: { content: parameters.content, id: 654321 } };
        },
      },
    },
  };
}

function assertCalledBefore(
  first: { readonly mock: { readonly invocationCallOrder: readonly number[] } },
  second: { readonly mock: { readonly invocationCallOrder: readonly number[] } },
): void {
  const firstCall = first.mock.invocationCallOrder[0];
  const secondCall = second.mock.invocationCallOrder[0];
  if (firstCall === undefined || secondCall === undefined) {
    throw new Error("Expected both spies to have been called");
  }

  expect(firstCall).toBeLessThan(secondCall);
}

function buildCommand(
  values: { readonly correlationId?: string } = {},
): IssueCommentCommandContext {
  return {
    commentId: CommentId,
    correlationId: values.correlationId ?? DeliveryId,
    issueNumber: PullRequestNumber,
    pullRequestNumber: PullRequestNumber,
    repoFullName: RepoFullName,
  };
}

function buildPullRequest(values: { readonly draft: boolean }) {
  return {
    additions: 12,
    base: {
      ref: "main",
      sha: BaseSha,
    },
    body: "Implement re-review.",
    changed_files: 1,
    deletions: 3,
    draft: values.draft,
    head: {
      ref: "task-77",
      sha: HeadSha,
    },
    number: PullRequestNumber,
    title: "Implement re-review",
    user: {
      login: "octocat",
    },
  };
}

function buildDiff(): Diff {
  return {
    files: [],
    unified_diff: "",
  };
}

function buildReview(): Review {
  return {
    completed_at: new Date("2026-05-18T10:00:01.000Z"),
    commit_sha: HeadSha,
    findings: [],
    id: "123e4567-e89b-42d3-a456-426614174001",
    llm_model: "test-model",
    llm_provider: "test-provider",
    pr_number: PullRequestNumber,
    repo_full_name: RepoFullName,
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
