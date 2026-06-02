// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { parseCommand, type ParsedCommand } from "../../src/commands/parser.js";
import {
  handleIssueCommentCreated,
  type IssueCommentHandlerDependencies,
  type IssueCommentWebhookContext,
} from "../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-issue-comment-001";
const SelfCommentDeliveryId = "delivery-issue-comment-002";
const PlainIssueDeliveryId = "delivery-issue-comment-003";
const CommandCorrelationDeliveryId = "delivery-issue-comment-004";
const CommandRoutingDeliveryId = "delivery-issue-comment-005";
const UnknownCommandDeliveryId = "delivery-issue-comment-006";
const DismissFormatDeliveryId = "delivery-dismiss-format-001";
const MalformedDismissFormatDeliveryId = "delivery-dismiss-format-002";
const ExtraDismissTokensDeliveryId = "delivery-dismiss-format-003";
const ReReviewDispatcherBoundaryDeliveryId = "delivery-re-review-003";
const ResolveUnsupportedDeliveryId = "delivery-resolve-unsupported-001";
const RepoFullName = "octo-org/sovri-target";
const PullRequestNumber = 42;
const PlainIssueNumber = 41;
const CommentId = 98_765;
const FindingId = "finding-abc-123";

describe("issue comment dispatcher - ATDD task 76", () => {
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

  it("skips plain issue comments before command parsing", async () => {
    const dependencies = buildDependencies();
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot dismiss finding-abc-123",
      deliveryId: PlainIssueDeliveryId,
      issueNumber: PlainIssueNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-003" for event "issue_comment.created"
    expect(context.id).toBe(PlainIssueDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 41 has no pull request link
    expect(context.payload.issue.number).toBe(PlainIssueNumber);
    expect(context.payload.issue.pull_request).toBeUndefined();
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-abc-123"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-abc-123");

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

  it("propagates delivery and comment IDs to the re-review handler", async () => {
    const dependencies = buildDependencies();
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot re-review",
      deliveryId: CommandCorrelationDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-004" for event "issue_comment.created"
    expect(context.id).toBe(CommandCorrelationDeliveryId);
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
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PullRequestNumber,
    );
    // And the re-review handler receives correlation ID "delivery-issue-comment-004"
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.correlationId).toBe(
      CommandCorrelationDeliveryId,
    );
    // And the re-review handler receives comment ID 98765
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.commentId).toBe(CommentId);
  });

  it("propagates delivery and comment IDs to the dismiss handler", async () => {
    const dependencies = buildDependencies({ kind: "dismiss", findingId: FindingId });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot dismiss finding-abc-123",
      deliveryId: CommandCorrelationDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-004" for event "issue_comment.created"
    expect(context.id).toBe(CommandCorrelationDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-abc-123"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-abc-123");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then the dismiss handler is called once for pull request 42
    expect(dependencies.handleDismiss).toHaveBeenCalledTimes(1);
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PullRequestNumber,
    );
    // And the dismiss handler receives finding ID "finding-abc-123"
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.findingId).toBe(FindingId);
    // And the dismiss handler receives correlation ID "delivery-issue-comment-004"
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.correlationId).toBe(
      CommandCorrelationDeliveryId,
    );
    // And the dismiss handler receives comment ID 98765
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.commentId).toBe(CommentId);
  });

  it("routes re-review commands without running review business logic", async () => {
    const dependencies = buildDependencies();
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot re-review",
      deliveryId: CommandRoutingDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-005" for event "issue_comment.created"
    expect(context.id).toBe(CommandRoutingDeliveryId);
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
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PullRequestNumber,
    );
    // And the dismiss handler is not called
    expect(dependencies.handleDismiss).not.toHaveBeenCalled();
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
    // And the dispatcher does not post a review result
    expect(dependencies.postReviewResult).not.toHaveBeenCalled();
  });

  it("re-review does not perform review work in the issue-comment dispatcher", async () => {
    const dependencies = buildDependencies({ kind: "re-review" });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot re-review",
      deliveryId: ReReviewDispatcherBoundaryDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-re-review-003" for event "issue_comment.created"
    expect(context.id).toBe(ReReviewDispatcherBoundaryDeliveryId);
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
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PullRequestNumber,
    );
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
    // And the dispatcher does not post a review result
    expect(dependencies.postReviewResult).not.toHaveBeenCalled();
  });

  it("routes dismiss commands without running review business logic", async () => {
    const dependencies = buildDependencies({ kind: "dismiss", findingId: FindingId });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot dismiss finding-abc-123",
      deliveryId: CommandRoutingDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-005" for event "issue_comment.created"
    expect(context.id).toBe(CommandRoutingDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-abc-123"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-abc-123");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then the dismiss handler is called once for pull request 42
    expect(dependencies.handleDismiss).toHaveBeenCalledTimes(1);
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PullRequestNumber,
    );
    // And the dismiss handler receives finding ID "finding-abc-123"
    expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.findingId).toBe(FindingId);
    // And the re-review handler is not called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
    // And the dispatcher does not post a review result
    expect(dependencies.postReviewResult).not.toHaveBeenCalled();
  });

  it("reacts confused to parsed resolve commands until resolve handling exists", async () => {
    const dependencies = buildDependencies({ kind: "resolve", findingId: FindingId });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot resolve finding-abc-123",
      deliveryId: ResolveUnsupportedDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-resolve-unsupported-001" for event "issue_comment.created"
    expect(context.id).toBe(ResolveUnsupportedDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot resolve finding-abc-123"
    expect(context.payload.comment.body).toBe("@sovri-bot resolve finding-abc-123");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then GitHub receives one reaction request for comment 98765 with content "confused"
    expect(dependencies.reactToUnknown).toHaveBeenCalledTimes(1);
    expect(dependencies.reactToUnknown).toHaveBeenCalledWith({
      commentId: CommentId,
      content: "confused",
    });
    // And no command handler is called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    expect(dependencies.handleDismiss).not.toHaveBeenCalled();
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
    // And the dispatcher does not post a review result
    expect(dependencies.postReviewResult).not.toHaveBeenCalled();
  });

  it.each(["a", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ABC-123-def"])(
    "routes valid boundary dismiss finding id %s through the real parser",
    async (findingId) => {
      const dependencies = buildDependencies();
      dependencies.parseCommand.mockImplementation(parseCommand);
      const context = buildIssueCommentContext({
        author: "alice",
        body: `@sovri-bot dismiss ${findingId}`,
        deliveryId: DismissFormatDeliveryId,
        pullRequestNumber: PullRequestNumber,
        repoFullName: RepoFullName,
      });

      // Given Probot has accepted delivery "delivery-dismiss-format-001" for event "issue_comment.created"
      expect(context.id).toBe(DismissFormatDeliveryId);
      expect(context.name).toBe("issue_comment.created");
      // And the repository is "octo-org/sovri-target"
      expect(context.payload.repository.full_name).toBe(RepoFullName);
      // And issue 42 is pull request 42
      expect(context.payload.issue.number).toBe(PullRequestNumber);
      expect(context.payload.issue.pull_request).toEqual({});
      // And comment 98765 was authored by "alice"
      expect(context.payload.comment.id).toBe(CommentId);
      expect(context.payload.comment.user.login).toBe("alice");
      // And the comment body is "@sovri-bot dismiss <finding_id>"
      expect(context.payload.comment.body).toBe(`@sovri-bot dismiss ${findingId}`);

      // When Sovri dispatches the issue comment webhook context
      await handleIssueCommentCreated(context, dependencies);

      // Then the dismiss handler is called once with finding id "<finding_id>"
      expect(dependencies.handleDismiss).toHaveBeenCalledTimes(1);
      expect(dependencies.handleDismiss.mock.calls[0]?.[0]?.findingId).toBe(findingId);
      // And no confused reaction is created for comment 98765
      expect(dependencies.reactToUnknown).not.toHaveBeenCalled();
      // And no error issue comment is created
      expect(dependencies.createIssueComment).not.toHaveBeenCalled();
    },
  );

  it.each([
    "abc_123",
    "abc.123",
    "abc/123",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ])(
    "reacts confused to malformed dismiss finding id %s through the real parser",
    async (findingId) => {
      const dependencies = buildDependencies();
      dependencies.parseCommand.mockImplementation(parseCommand);
      const context = buildIssueCommentContext({
        author: "alice",
        body: `@sovri-bot dismiss ${findingId}`,
        deliveryId: MalformedDismissFormatDeliveryId,
        pullRequestNumber: PullRequestNumber,
        repoFullName: RepoFullName,
      });

      // Given Probot has accepted delivery "delivery-dismiss-format-002" for event "issue_comment.created"
      expect(context.id).toBe(MalformedDismissFormatDeliveryId);
      expect(context.name).toBe("issue_comment.created");
      // And the repository is "octo-org/sovri-target"
      expect(context.payload.repository.full_name).toBe(RepoFullName);
      // And issue 42 is pull request 42
      expect(context.payload.issue.number).toBe(PullRequestNumber);
      expect(context.payload.issue.pull_request).toEqual({});
      // And comment 98765 was authored by "alice"
      expect(context.payload.comment.id).toBe(CommentId);
      expect(context.payload.comment.user.login).toBe("alice");
      // And the comment body is "@sovri-bot dismiss <finding_id>"
      expect(context.payload.comment.body).toBe(`@sovri-bot dismiss ${findingId}`);

      // When Sovri dispatches the issue comment webhook context
      await handleIssueCommentCreated(context, dependencies);

      // Then GitHub receives one reaction request for comment 98765 with content "confused"
      expect(dependencies.reactToUnknown).toHaveBeenCalledTimes(1);
      expect(dependencies.reactToUnknown).toHaveBeenCalledWith({
        commentId: CommentId,
        content: "confused",
      });
      // And no command handler is called
      expect(dependencies.handleReReview).not.toHaveBeenCalled();
      expect(dependencies.handleDismiss).not.toHaveBeenCalled();
      // And no issue comment is created
      expect(dependencies.createIssueComment).not.toHaveBeenCalled();
      // And no pull request review comment reaction is created
      expect(dependencies.postReviewResult).not.toHaveBeenCalled();
      // And no pull request label is added
      expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
    },
  );

  it("does not partially parse a dismiss command with extra tokens", async () => {
    const dependencies = buildDependencies();
    dependencies.parseCommand.mockImplementation(parseCommand);
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot dismiss finding-abc-123 duplicate",
      deliveryId: ExtraDismissTokensDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-dismiss-format-003" for event "issue_comment.created"
    expect(context.id).toBe(ExtraDismissTokensDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-abc-123 duplicate"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-abc-123 duplicate");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then GitHub receives one reaction request for comment 98765 with content "confused"
    expect(dependencies.reactToUnknown).toHaveBeenCalledTimes(1);
    expect(dependencies.reactToUnknown).toHaveBeenCalledWith({
      commentId: CommentId,
      content: "confused",
    });
    // And no command handler is called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    expect(dependencies.handleDismiss).not.toHaveBeenCalled();
    // And no GitHub request searches pull request review comments
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
  });

  it("silently skips no-mention comments", async () => {
    const dependencies = buildDependencies({ kind: "no-mention" });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "Looks good to me",
      deliveryId: CommandRoutingDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-005" for event "issue_comment.created"
    expect(context.id).toBe(CommandRoutingDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "Looks good to me"
    expect(context.payload.comment.body).toBe("Looks good to me");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then no command handler is called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    expect(dependencies.handleDismiss).not.toHaveBeenCalled();
    // And no reaction is created on comment 98765
    expect(dependencies.reactToUnknown).not.toHaveBeenCalled();
    // And no issue comment is created
    expect(dependencies.createIssueComment).not.toHaveBeenCalled();
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
  });

  it("reacts confused to unknown mentions without command side effects", async () => {
    const dependencies = buildDependencies({ kind: "unknown", raw: "explain this finding" });
    const context = buildIssueCommentContext({
      author: "alice",
      body: "@sovri-bot explain this finding",
      deliveryId: UnknownCommandDeliveryId,
      pullRequestNumber: PullRequestNumber,
      repoFullName: RepoFullName,
    });

    // Given Probot has accepted delivery "delivery-issue-comment-006" for event "issue_comment.created"
    expect(context.id).toBe(UnknownCommandDeliveryId);
    expect(context.name).toBe("issue_comment.created");
    // And the repository is "octo-org/sovri-target"
    expect(context.payload.repository.full_name).toBe(RepoFullName);
    // And issue 42 is pull request 42
    expect(context.payload.issue.number).toBe(PullRequestNumber);
    expect(context.payload.issue.pull_request).toEqual({});
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user.login).toBe("alice");
    // And the comment body is "@sovri-bot explain this finding"
    expect(context.payload.comment.body).toBe("@sovri-bot explain this finding");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then GitHub receives one reaction request for comment 98765 with content "confused"
    expect(dependencies.reactToUnknown).toHaveBeenCalledTimes(1);
    expect(dependencies.reactToUnknown).toHaveBeenCalledWith({
      commentId: CommentId,
      content: "confused",
    });
    // And no command handler is called
    expect(dependencies.handleReReview).not.toHaveBeenCalled();
    expect(dependencies.handleDismiss).not.toHaveBeenCalled();
    // And no issue comment is created
    expect(dependencies.createIssueComment).not.toHaveBeenCalled();
    // And the dispatcher does not fetch a pull request diff
    expect(dependencies.fetchPullRequestDiff).not.toHaveBeenCalled();
  });
});

type CommandParser = (body: string) => ParsedCommand;

type DismissCommandContext = {
  readonly commentId: number;
  readonly correlationId: string;
  readonly findingId: string;
  readonly issueNumber: number;
  readonly pullRequestNumber: number;
  readonly repoFullName: string;
};

type UnknownCommandReaction = {
  readonly commentId: number;
  readonly content: "confused";
};

function buildDependencies(command: ParsedCommand = { kind: "re-review" }) {
  return {
    botLogin: "sovri-bot[bot]",
    createIssueComment: vi.fn<(body: string) => Promise<void>>(async () => undefined),
    fetchPullRequestDiff: vi.fn<() => Promise<void>>(async () => undefined),
    handleDismiss: vi.fn<(context: DismissCommandContext) => Promise<void>>(async () => undefined),
    handleReReview: vi.fn<IssueCommentHandlerDependencies["handleReReview"]>(async () => undefined),
    parseCommand: vi.fn<CommandParser>(() => command),
    postReviewResult: vi.fn<() => Promise<void>>(async () => undefined),
    reactToUnknown: vi.fn<(reaction: UnknownCommandReaction) => Promise<void>>(
      async () => undefined,
    ),
  };
}

type IssueCommentContextValues = {
  readonly author: string;
  readonly body: string;
  readonly deliveryId: string;
  readonly repoFullName: string;
} & (
  | {
      readonly issueNumber: number;
      readonly pullRequestNumber?: undefined;
    }
  | {
      readonly issueNumber?: undefined;
      readonly pullRequestNumber: number;
    }
);

function buildIssueCommentContext(values: IssueCommentContextValues): IssueCommentWebhookContext {
  const issueNumber = values.issueNumber ?? values.pullRequestNumber;
  const issue: IssueCommentWebhookContext["payload"]["issue"] = {
    number: issueNumber,
  };
  if (values.pullRequestNumber !== undefined) {
    issue.pull_request = {};
  }

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
      issue,
      repository: {
        full_name: values.repoFullName,
      },
    },
  };
}
