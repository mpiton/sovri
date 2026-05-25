// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import {
  handleIssueCommentCreated,
  type IssueCommentHandlerDependencies,
  type IssueCommentWebhookContext,
} from "../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-issue-comment-001";
const SelfCommentDeliveryId = "delivery-issue-comment-002";
const RepoFullName = "octo-org/sovri-target";
const PullRequestNumber = 42;
const CommentId = 98_765;

describe("issue comment dispatcher - ATDD #1532", () => {
  it("routes a Probot-validated re-review comment without raw signature plumbing", async () => {
    const dependencies = buildDependencies();
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot re-review",
      deliveryId: DeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-001" for event "issue_comment.created"
    expect(context.id).toBe(DeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot re-review"
    expect(context.payload.comment.body).toBe("@sovri-bot re-review");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then the re-review handler is called once for pull request 42
    expect(dependencies.handleReReview).toHaveBeenCalledTimes(1);
    expect(dependencies.handleReReview).toHaveBeenCalledWith({
      commentId: CommentId,
      correlationId: DeliveryId,
      issueNumber: PullRequestNumber,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });
    // And the re-review handler receives correlation ID "delivery-issue-comment-001"
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.correlationId).toBe(DeliveryId);
    // And no dispatcher dependency receives a raw "x-hub-signature-256" header
    expect(JSON.stringify(dependencies.handleReReview.mock.calls[0]?.[0])).not.toContain(
      "x-hub-signature-256",
    );
  });

  it("skips bot self-comments before command parsing", async () => {
    const dependencies = buildDependencies();
    const context = buildIssueCommentContext({
      author: "sovri-bot[bot]",
      body: "@sovri-bot re-review",
      deliveryId: SelfCommentDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-002" for event "issue_comment.created"
    expect(context.id).toBe(SelfCommentDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the authenticated bot login is "sovri-bot[bot]"
    expect(dependencies.botLogin).toBe("sovri-bot[bot]");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "sovri-bot[bot]"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("sovri-bot[bot]");
    // And the comment body is "@sovri-bot re-review"
    expect(context.payload.comment.body).toBe("@sovri-bot re-review");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then the command parser is not called
    expect(dependencies.parseCommand).not.toHaveBeenCalled();
    // And no command handler is called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    // And no reaction is created on comment 98765
    expect(dependencies.reactToUnknown).not.toHaveBeenCalled();
    // And no issue comment is created
    expect(dependencies.createIssueComment).not.toHaveBeenCalled();
  });
});

type CommandParser = (body: string) => { readonly kind: "re-review" };

function buildDependencies() {
  return {
    botLogin: "sovri-bot[bot]",
    createIssueComment: vi.fn<(body: string) => Promise<void>>(async () => undefined),
    handleReReview: vi.fn<IssueCommentHandlerDependencies["handleReReview"]>(async () => undefined),
    parseCommand: vi.fn<CommandParser>(() => ({ kind: "re-review" })),
    reactToUnknown: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

function buildIssueCommentContext(values: {
  readonly author: string;
  readonly body: string;
  readonly deliveryId: string;
  readonly pullRequestNumber: number;
  readonly repoFullName: string;
}): IssueCommentWebhookContext {
  return {
    id: values.deliveryId,
    name: "issue_comment.created",
    payload: {
      comment: {
        body: values.body,
        id: CommentId,
        user: {
          login: values.author,
        },
      },
      issue: {
        number: values.pullRequestNumber,
        pull_request: {},
      },
      repository: {
        full_name: values.repoFullName,
      },
    },
  };
}
