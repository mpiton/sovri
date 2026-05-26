// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { createIssueCommentHandlerDependencies } from "../../../src/github/issue-comment-dispatcher.js";
import { handleIssueCommentCreated } from "../../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-dismiss-unknown-001";
const ExtraDismissTokensDeliveryId = "delivery-dismiss-format-003";
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
const MarkdownWrappedInlineCommentBody = [
  "> **Dismissable finding**",
  "> The marker is surrounded by normal review Markdown.",
  "",
  "<details>",
  "<summary>Context</summary>",
  "",
  "<!-- sovri-finding-id: finding-markdown-001 -->",
  "",
  "```ts",
  "payload.user.login",
  "```",
  "",
  "</details>",
].join("\n");
const VisibleOnlyInlineCommentBody = [
  "**finding-visible-only**",
  "",
  "This comment mentions finding-visible-only in visible Markdown only.",
].join("\n");
const CostFooter = "_Tokens: 1234 in / 567 out. Estimated cost: $0.0123._";
const FinalFindingCostFooter = "_Tokens: 40 in / 10 out. Estimated cost: $0.0004._";
const EndToEndCostFooter = "_Tokens: 2048 in / 256 out. Estimated cost: $0.0188._";
const MarkedWalkthroughBody = [
  "<!-- sovri:walkthrough -->",
  "## Sovri review",
  "",
  "### Findings",
  "",
  "- <!-- sovri-finding-id: finding-alpha --> finding-alpha",
  "- <!-- sovri-finding-id: finding-beta --> finding-beta",
  "- <!-- sovri-finding-id: finding-gamma --> finding-gamma",
  "",
  "### File-by-file",
  "",
  "- <!-- sovri-finding-id: finding-alpha --> src/alpha.ts finding-alpha",
  "- <!-- sovri-finding-id: finding-beta --> src/beta.ts finding-beta",
  "- <!-- sovri-finding-id: finding-gamma --> src/gamma.ts finding-gamma",
].join("\n");
const MarkedWalkthroughWithCostFooter = [
  "<!-- sovri:walkthrough -->",
  "## Sovri review",
  "",
  "### Findings",
  "",
  "- <!-- sovri-finding-id: finding-alpha --> finding-alpha",
  "- <!-- sovri-finding-id: finding-beta --> finding-beta",
  "",
  "---",
  "",
  CostFooter,
].join("\n");
const SingleFindingWalkthroughWithCostFooter = [
  "<!-- sovri:walkthrough -->",
  "## Sovri review",
  "",
  "### Findings",
  "",
  "- <!-- sovri-finding-id: finding-only --> finding-only",
  "",
  "---",
  "",
  FinalFindingCostFooter,
].join("\n");
const EndToEndWalkthroughWithCostFooter = [
  "<!-- sovri:walkthrough -->",
  "## Sovri review",
  "",
  "### Findings",
  "",
  "- <!-- sovri-finding-id: finding-alpha --> finding-alpha",
  "- <!-- sovri-finding-id: finding-beta --> finding-beta",
  "",
  "---",
  "",
  EndToEndCostFooter,
].join("\n");

describe("dismiss command handler", () => {
  it("treats a dismiss command with extra tokens as unknown before review comment search", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      commentBody: "@sovri-bot dismiss finding-abc-123 duplicate",
      deliveryId: ExtraDismissTokensDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    // Given Probot has accepted delivery "delivery-dismiss-format-003" for event "issue_comment.created"
    expect(context.id).toBe(ExtraDismissTokensDeliveryId);
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
    // And comment 98765 was authored by "alice"
    expect(context.payload.comment.id).toBe(CommentId);
    expect(context.payload.comment.user?.login).toBe("alice");
    // And the comment body is "@sovri-bot dismiss finding-abc-123 duplicate"
    expect(context.payload.comment.body).toBe("@sovri-bot dismiss finding-abc-123 duplicate");

    // When Sovri dispatches the issue comment webhook context
    await handleIssueCommentCreated(context, dependencies);

    // Then GitHub receives one reaction request for comment 98765 with content "confused"
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "confused",
      owner: "octo-org",
      repo: "sovri-target",
    });
    // And no command handler is called
    expect(runtime.octokit.rest.pulls.get).not.toHaveBeenCalled();
    // And no GitHub request searches pull request review comments
    expect(runtime.octokit.rest.pulls.listReviewComments).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

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

  it("stores dismissed state when an inline marker matches", async () => {
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
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledTimes(
      1,
    );
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledWith({
      comment_id: InlineCommentId,
      content: "-1",
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: PullRequestNumber,
      labels: ["sovri:dismissed-finding"],
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("parses an inline marker surrounded by normal markdown", async () => {
    const runtime = buildRuntime({
      inlineCommentBody: MarkdownWrappedInlineCommentBody,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-markdown-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledWith({
      comment_id: InlineCommentId,
      content: "-1",
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: PullRequestNumber,
      labels: ["sovri:dismissed-finding"],
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("does not dismiss a finding when the commenter is not the pull request author", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      commentAuthorLogin: "mallory",
      findingId: "finding-known-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.get).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "octo-org",
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: expect.stringContaining("Only the pull request author can dismiss findings."),
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
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

  it("updates the walkthrough without findings dismissed by the bot", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-alpha -->",
          id: 501,
          user: {
            login: "sovri-bot",
          },
        },
        {
          body: "<!-- sovri-finding-id: finding-beta -->",
          id: 502,
          user: {
            login: "sovri-bot",
          },
        },
        {
          body: "<!-- sovri-finding-id: finding-gamma -->",
          id: 503,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        502: [{ content: "-1", user: { login: "sovri-bot" } }],
        503: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: MarkedWalkthroughBody,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-beta",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.updateReview).toHaveBeenCalledTimes(1);
    const updateRequest = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0];
    expect(updateRequest).toEqual(
      expect.objectContaining({
        owner: "octo-org",
        pull_number: PullRequestNumber,
        repo: "sovri-target",
        review_id: 6000,
      }),
    );
    expect(updateRequest?.body).toContain("finding-alpha");
    expect(updateRequest?.body).toContain("<!-- sovri-finding-id: finding-alpha -->");
    expect(updateRequest?.body).not.toContain("finding-beta");
    expect(updateRequest?.body).not.toContain("finding-gamma");
  });

  it("keeps findings with only human thumbs-down reactions visible in the walkthrough", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-alpha -->",
          id: 501,
          user: {
            login: "sovri-bot",
          },
        },
        {
          body: "<!-- sovri-finding-id: finding-beta -->",
          id: 502,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        501: [{ content: "-1", user: { login: "bob" } }],
        502: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: MarkedWalkthroughBody,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-beta",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.updateReview).toHaveBeenCalledTimes(1);
    const updateRequest = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0];
    expect(updateRequest?.body).toContain("finding-alpha");
    expect(updateRequest?.body).toContain("<!-- sovri-finding-id: finding-alpha -->");
    expect(updateRequest?.body).not.toContain("finding-beta");
  });

  it("updates a fallback issue-comment walkthrough on its original surface", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-beta -->",
          id: 502,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        502: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughIssueCommentBody: MarkedWalkthroughBody,
      walkthroughReviewBody: null,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-beta",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).toHaveBeenCalledTimes(1);
    const updateRequest = runtime.octokit.rest.issues.updateComment.mock.calls[0]?.[0];
    expect(updateRequest).toEqual(
      expect.objectContaining({
        comment_id: 7000,
        owner: "octo-org",
        repo: "sovri-target",
      }),
    );
    expect(updateRequest?.body).toContain("finding-alpha");
    expect(updateRequest?.body).toContain("<!-- sovri-finding-id: finding-alpha -->");
    expect(updateRequest?.body).not.toContain("finding-beta");
  });

  it("keeps the existing cost footer last after dismissing one finding", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-alpha -->",
          id: 501,
          user: {
            login: "sovri-bot",
          },
        },
        {
          body: "<!-- sovri-finding-id: finding-beta -->",
          id: 502,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        502: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: MarkedWalkthroughWithCostFooter,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-beta",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    const updateRequest = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0];
    expect(updateRequest?.body).toContain("finding-alpha");
    expect(updateRequest?.body).not.toContain("finding-beta");
    expect(updateRequest?.body).toContain(CostFooter);
    expect(lastNonEmptyLine(updateRequest?.body ?? "")).toBe(CostFooter);
  });

  it("keeps the cost footer after no findings when dismissing the final visible finding", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-only -->",
          id: InlineCommentId,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        [InlineCommentId]: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: SingleFindingWalkthroughWithCostFooter,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-only",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    const updateBody = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0]?.body ?? "";
    expect(updateBody).toContain("No findings.");
    expect(updateBody).not.toContain("finding-only");
    expect(updateBody).toContain(FinalFindingCostFooter);
    expect(updateBody.indexOf("No findings.")).toBeLessThan(
      updateBody.indexOf(FinalFindingCostFooter),
    );
    expect(lastNonEmptyLine(updateBody)).toBe(FinalFindingCostFooter);
  });

  it("preserves the marked walkthrough footer during end-to-end dismiss update", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-alpha -->",
          id: 501,
          user: {
            login: "sovri-bot",
          },
        },
        {
          body: "<!-- sovri-finding-id: finding-beta -->",
          id: 502,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        502: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: EndToEndWalkthroughWithCostFooter,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-beta",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    const updateBody = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0]?.body ?? "";
    expect(updateBody).not.toContain("finding-beta");
    expect(updateBody).toContain("finding-alpha");
    expect(lastNonEmptyLine(updateBody)).toBe(EndToEndCostFooter);
  });

  it("accepts repeated dismiss without creating a duplicate finding reaction", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-abc-123 -->",
          id: InlineCommentId,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        [InlineCommentId]: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
      walkthroughReviewBody: "<!-- sovri:walkthrough -->\n## Sovri review",
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-abc-123",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("does not report an already dismissed finding as an error", async () => {
    const runtime = buildRuntime({
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-abc-123 -->",
          id: InlineCommentId,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      reviewCommentReactions: {
        [InlineCommentId]: [{ content: "-1", user: { login: "sovri-bot" } }],
      },
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-abc-123",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("already dismissed"),
      }),
    );
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("not found"),
      }),
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("treats a duplicate dismiss reaction response as accepted state", async () => {
    const runtime = buildRuntime({
      createReviewCommentReactionError: Object.assign(new Error("Reaction already exists"), {
        status: 422,
      }),
      reviewComments: [
        {
          body: "<!-- sovri-finding-id: finding-race-001 -->",
          id: InlineCommentId,
          user: {
            login: "sovri-bot",
          },
        },
      ],
      walkthroughReviewBody: [
        "<!-- sovri:walkthrough -->",
        "## Sovri review",
        "",
        "- <!-- sovri-finding-id: finding-race-001 --> finding-race-001",
        "- <!-- sovri-finding-id: finding-alpha --> finding-alpha",
      ].join("\n"),
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-race-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.pulls.updateReview).toHaveBeenCalledTimes(1);
    const updateRequest = runtime.octokit.rest.pulls.updateReview.mock.calls[0]?.[0];
    expect(updateRequest?.body).not.toContain("finding-race-001");
    expect(updateRequest?.body).toContain("finding-alpha");
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("does not treat visible finding text without a hidden marker as a match", async () => {
    const runtime = buildRuntime({
      inlineCommentBody: VisibleOnlyInlineCommentBody,
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "finding-visible-only",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: expect.stringContaining("finding-visible-only"),
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});

type ReviewCommentFixture = {
  readonly body?: string | null;
  readonly id: number;
  readonly user?: {
    readonly login?: string;
  };
};

type ReactionFixture = {
  readonly content: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

function buildRuntime(
  options: {
    readonly createReviewCommentReactionError?: unknown;
    readonly inlineCommentBody?: string;
    readonly reviewCommentReactions?: Readonly<Record<number, readonly ReactionFixture[]>>;
    readonly reviewComments?: readonly ReviewCommentFixture[];
    readonly walkthroughIssueCommentBody?: string;
    readonly walkthroughReviewBody?: string | null;
  } = {},
) {
  const inlineCommentBody = options.inlineCommentBody ?? KnownInlineCommentBody;
  const reviewComments = options.reviewComments ?? [
    {
      body: inlineCommentBody,
      id: InlineCommentId,
      user: {
        login: "sovri-bot",
      },
    },
  ];
  const walkthroughIssueCommentBody =
    options.walkthroughIssueCommentBody ?? "<!-- sovri:walkthrough -->\n## Sovri review";
  const walkthroughReviewBody =
    options.walkthroughReviewBody === undefined
      ? "<!-- sovri:walkthrough -->\n## Sovri review"
      : options.walkthroughReviewBody;
  const octokit = {
    rest: {
      issues: {
        addLabels: vi.fn(async () => ({ data: {} })),
        createComment: vi.fn(async () => ({ data: { id: 7001 } })),
        listComments: vi.fn(async () => ({
          data: [
            {
              body: walkthroughIssueCommentBody,
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
        createReview: vi.fn(async () => ({ data: { id: 6000 } })),
        createReviewComment: vi.fn(async () => ({ data: { id: 8000 } })),
        get: vi.fn(async () => ({ data: { user: { login: "alice" } } })),
        listReviewComments: vi.fn(async () => ({
          data: reviewComments,
        })),
        listReviews: vi.fn(async () => ({
          data:
            walkthroughReviewBody === null
              ? []
              : [
                  {
                    body: walkthroughReviewBody,
                    id: 6000,
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
        createForPullRequestReviewComment: vi.fn(async () => {
          if (options.createReviewCommentReactionError !== undefined) {
            throw options.createReviewCommentReactionError;
          }

          return { data: {} };
        }),
        listForPullRequestReviewComment: vi.fn(async (parameters: { comment_id: number }) => ({
          data: options.reviewCommentReactions?.[parameters.comment_id] ?? [],
        })),
      },
    },
  };

  return {
    inlineComment: {
      body: inlineCommentBody,
      id: InlineCommentId,
      user: {
        login: "sovri-bot",
      },
    },
    octokit,
  };
}

function lastNonEmptyLine(value: string): string | undefined {
  const lines = value.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line !== undefined && line.length > 0) {
      return line;
    }
  }

  return undefined;
}

function buildIssueCommentContext(
  octokit: ReturnType<typeof buildRuntime>["octokit"],
  options: {
    readonly commentAuthorLogin?: string;
    readonly commentBody?: string;
    readonly deliveryId?: string;
    readonly findingId?: string;
  } = {},
) {
  const commentAuthorLogin = options.commentAuthorLogin ?? "alice";
  const findingId = options.findingId ?? "finding-missing-001";
  return {
    id: options.deliveryId ?? DeliveryId,
    name: "issue_comment.created",
    octokit,
    payload: {
      comment: {
        body: options.commentBody ?? `@sovri-bot dismiss ${findingId}`,
        id: CommentId,
        user: {
          login: commentAuthorLogin,
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
