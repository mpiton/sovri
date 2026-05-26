// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { createIssueCommentHandlerDependencies } from "../../../src/github/issue-comment-dispatcher.js";
import { handleIssueCommentCreated } from "../../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-dismiss-unknown-001";
const RepoFullName = "octo-org/sovri-target";
const PullRequestNumber = 42;
const CommentId = 98_765;
const InlineCommentId = 501;
const KnownInlineCommentBody = [
  "**Missing null guard**",
  "",
  "Add a guard before reading payload.user.",
  "<!-- sovri-finding-id: finding-known-001 -->",
].join("\n");

describe("dismiss command handler", () => {
  it("posts one error comment without mutating state when the finding id is unknown", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    // Given Probot has accepted delivery "delivery-dismiss-unknown-001" for event "issue_comment.created"
    expect(context.id).toBe(DeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({
      user: {
        login: "alice",
      },
    });
    // And pull request 42 was opened by "alice"
    expect(context.payload.issue.pull_request).toEqual({
      user: {
        login: "alice",
      },
    });
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user?.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-missing-001"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-missing-001");
    // And pull request review comment 501 has body:
    expect(runtime.inlineComment).toEqual({
      body: KnownInlineCommentBody,
      id: InlineCommentId,
      user: {
        login: "sovri-bot",
      },
    });

    // When Sovri handles the dismiss command
    await handleIssueCommentCreated(context, dependencies);

    // Then GitHub receives one issue comment on pull request 42 explaining that finding id "finding-missing-001" was not found
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: expect.stringContaining("finding-missing-001"),
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.createComment.mock.calls[0]?.[0]?.body).toContain(
      "not found",
    );
    // And GitHub receives no reaction request for pull request review comment 501
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    // And GitHub receives no label request for pull request 42
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    // And GitHub receives no walkthrough update request
    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    // And GitHub receives no accepted reaction request for comment 98765
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("does not post the unknown-finding error when an inline marker matches", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-known-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.listReviewComments).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "octo-org",
        pull_number: PullRequestNumber,
        repo: "sovri-target",
      }),
    );
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("does not post the unknown-finding error when the matching marker is on a later review comment page", async () => {
    const runtime = buildRuntime();
    runtime.octokit.rest.pulls.listReviewComments
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, index) => ({
          body: `Review comment without marker ${index}`,
          id: InlineCommentId + index,
          user: {
            login: "sovri-bot",
          },
        })),
      })
      .mockResolvedValueOnce({
        data: [
          {
            body: KnownInlineCommentBody,
            id: InlineCommentId,
            user: {
              login: "sovri-bot",
            },
          },
        ],
      });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-known-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.listReviewComments).toHaveBeenNthCalledWith(1, {
      owner: "octo-org",
      page: 1,
      per_page: 100,
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).toHaveBeenNthCalledWith(2, {
      owner: "octo-org",
      page: 2,
      per_page: 100,
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
});

function buildRuntime() {
  const octokit = {
    rest: {
      issues: {
        addLabels: vi.fn(async () => ({ data: {} })),
        createComment: vi.fn(async () => ({ data: { id: 7001 } })),
        listComments: vi.fn(async () => ({
          data: [
            {
              body: "<!-- sovri:walkthrough -->\n## Sovri review",
              id: 7000,
              user: {
                login: "sovri-bot",
              },
            },
          ],
        })),
        updateComment: vi.fn(async () => ({ data: { id: 7000 } })),
      },
      pulls: {
        get: vi.fn(async () => ({ data: { user: { login: "alice" } } })),
        listReviewComments: vi.fn(async () => ({
          data: [
            {
              body: KnownInlineCommentBody,
              id: InlineCommentId,
              user: {
                login: "sovri-bot",
              },
            },
          ],
        })),
        updateReview: vi.fn(async () => ({ data: { id: 6000 } })),
      },
      reactions: {
        createForIssueComment: vi.fn(async () => ({ data: {} })),
        createForPullRequestReviewComment: vi.fn(async () => ({ data: {} })),
        listForPullRequestReviewComment: vi.fn(async () => ({ data: [] })),
      },
    },
  };

  return {
    inlineComment: {
      body: KnownInlineCommentBody,
      id: InlineCommentId,
      user: {
        login: "sovri-bot",
      },
    },
    octokit,
  };
}

function buildIssueCommentContext(
  octokit: ReturnType<typeof buildRuntime>["octokit"],
  options: { readonly findingId?: string } = {},
) {
  const findingId = options.findingId ?? "finding-missing-001";
  return {
    id: DeliveryId,
    name: "issue_comment.created",
    octokit,
    payload: {
      comment: {
        body: `@sovri-bot dismiss ${findingId}`,
        id: CommentId,
        user: {
          login: "alice",
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
