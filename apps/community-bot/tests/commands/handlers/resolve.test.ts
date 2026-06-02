// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { createIssueCommentHandlerDependencies } from "../../../src/github/issue-comment-dispatcher.js";
import { handleIssueCommentCreated } from "../../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-resolve-thread-001";
const AuthzFailureDeliveryId = "delivery-resolve-authz-001";
const FailureDeliveryId = "delivery-resolve-failure-001";
const RepoFullName = "octo-org/sovri-target";
const PullRequestNumber = 42;
const CommentId = 98_765;
const ReviewCommentId = 501;
const ReviewCommentNodeId = "PRRC_thread_001";
const ThreadId = "PRRT_thread_001";
const KnownFindingId = "finding-thread-001";
const KnownInlineCommentBody = [
  "**Missing null guard**",
  "",
  "Add a guard before reading payload.user.",
  `<!-- sovri-finding-id: ${KnownFindingId} -->`,
].join("\n");

// Exercises the resolve command as a GitHub adapter workflow: author gating,
// finding lookup, thread resolution/fallback, idempotency, and surfaced failures.
describe("resolve command handler", () => {
  it("resolves the matching bot review thread and acknowledges the command", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "octo-org",
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).toHaveBeenCalledWith({
      owner: "octo-org",
      page: 1,
      per_page: 100,
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.graphqlCalls.some((call) => call.query.includes("resolveReviewThread"))).toBe(
      true,
    );
    expect(runtime.graphqlCalls).toContainEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ threadId: ThreadId }),
      }),
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("does not resolve a finding when the commenter is not the pull request author", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      commentAuthorLogin: "mallory",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Only the pull request author can resolve findings.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("logs and surfaces pull request author lookup failures without crashing", async () => {
    const runtime = buildRuntime({
      authorLookupError: Object.assign(new Error("GitHub 500"), { status: 500 }),
    });
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: AuthzFailureDeliveryId,
      findingId: "finding-authz-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: AuthzFailureDeliveryId,
        github_status: 500,
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Resolve command failed",
    );
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Resolve command could not be completed. Please retry later.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).not.toHaveBeenCalled();
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("posts a not-found message without changing state for an unknown finding id", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "missing-finding-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Finding missing-finding-001 was not found, so nothing changed.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("falls back to minimizing the review comment when no thread id is available", async () => {
    const runtime = buildRuntime({ thread: "missing" });
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.graphqlCalls.some((call) => call.query.includes("minimizeComment"))).toBe(true);
    expect(runtime.graphqlCalls).toContainEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ subjectId: ReviewCommentNodeId }),
      }),
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("acknowledges an already-resolved thread without resolving it again", async () => {
    const runtime = buildRuntime({ thread: "resolved" });
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.graphqlCalls.some((call) => call.query.includes("resolveReviewThread"))).toBe(
      false,
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("logs and surfaces hard resolve failures without crashing the webhook", async () => {
    const runtime = buildRuntime({
      resolveError: Object.assign(new Error("GitHub 503"), { status: 503 }),
    });
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: FailureDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: FailureDeliveryId,
        github_status: 503,
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Resolve command failed",
    );
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Resolve command could not be completed. Please retry later.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });
});

type ReviewThreadMode = "missing" | "open" | "resolved";

type RuntimeOptions = {
  readonly authorLookupError?: unknown;
  readonly resolveError?: unknown;
  readonly thread?: ReviewThreadMode;
};

type GraphqlCall = {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

function buildRuntime(options: RuntimeOptions = {}) {
  const thread = options.thread ?? "open";
  const graphqlCalls: GraphqlCall[] = [];
  const octokit = {
    graphql: vi.fn(async (query: string, variables: Readonly<Record<string, unknown>>) => {
      graphqlCalls.push({ query, variables });
      if (query.includes("resolveReviewThread")) {
        if (options.resolveError !== undefined) {
          throw options.resolveError;
        }
        return { resolveReviewThread: { thread: { isResolved: true } } };
      }
      if (query.includes("minimizeComment")) {
        return { minimizeComment: { minimizedComment: { isMinimized: true } } };
      }
      return resolveReviewThreadsResponse(thread);
    }),
    rest: {
      issues: {
        addLabels: vi.fn(async () => ({ data: {} })),
        createComment: vi.fn(async () => ({ data: { id: 7001 } })),
        listComments: vi.fn(async () => ({ data: [] })),
        updateComment: vi.fn(async () => ({ data: { id: 7000 } })),
      },
      pulls: {
        createReview: vi.fn(async () => ({ data: { id: 6000 } })),
        createReviewComment: vi.fn(async () => ({ data: { id: 8000 } })),
        get: vi.fn(async () => {
          if (options.authorLookupError !== undefined) {
            throw options.authorLookupError;
          }
          return { data: { user: { login: "alice" } } };
        }),
        listReviewComments: vi.fn(async () => ({
          data: [
            {
              body: KnownInlineCommentBody,
              id: ReviewCommentId,
              node_id: ReviewCommentNodeId,
              user: { login: "sovri-bot" },
            },
          ],
        })),
        listReviews: vi.fn(async () => ({ data: [] })),
        updateReview: vi.fn(async () => ({ data: { id: 6000 } })),
      },
      reactions: {
        createForIssueComment: vi.fn(async () => ({ data: {} })),
        createForPullRequestReviewComment: vi.fn(async () => ({ data: {} })),
        listForPullRequestReviewComment: vi.fn(async () => ({ data: [] })),
      },
    },
  };

  return { graphqlCalls, octokit };
}

function resolveReviewThreadsResponse(mode: ReviewThreadMode): unknown {
  const nodes =
    mode === "missing"
      ? []
      : [
          {
            comments: {
              nodes: [
                {
                  author: { login: "sovri-bot" },
                  body: KnownInlineCommentBody,
                },
              ],
            },
            id: ThreadId,
            isResolved: mode === "resolved",
          },
        ];
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes,
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
        },
      },
    },
  };
}

function buildLogger() {
  return {
    error: vi.fn<(bindings: Readonly<Record<string, unknown>>, message: string) => void>(
      () => undefined,
    ),
    info: vi.fn<(bindings: Readonly<Record<string, unknown>>, message: string) => void>(
      () => undefined,
    ),
  };
}

function buildIssueCommentContext(
  octokit: ReturnType<typeof buildRuntime>["octokit"],
  options: {
    readonly commentAuthorLogin?: string;
    readonly deliveryId?: string;
    readonly findingId?: string;
  } = {},
) {
  const findingId = options.findingId ?? KnownFindingId;
  return {
    id: options.deliveryId ?? DeliveryId,
    name: "issue_comment.created",
    octokit,
    payload: {
      comment: {
        body: `@sovri-bot resolve ${findingId}`,
        id: CommentId,
        user: {
          login: options.commentAuthorLogin ?? "alice",
        },
      },
      issue: {
        number: PullRequestNumber,
        pull_request: {
          user: {
            login: "alice",
          },
        },
      },
      repository: {
        full_name: RepoFullName,
      },
    },
  };
}
