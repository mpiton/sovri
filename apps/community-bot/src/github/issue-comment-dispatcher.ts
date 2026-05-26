// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import {
  createReReviewCommandDependencies,
  handleReReviewCommand,
  type ReReviewOctokit,
} from "../commands/handlers/re-review.js";
import { parseCommand } from "../commands/parser.js";
import type {
  IssueCommentDismissCommandContext,
  IssueCommentHandlerDependencies,
  IssueCommentUnknownReaction,
} from "../handlers/issue-comment.js";
import { WALKTHROUGH_MARKER } from "./comment-poster.js";

const DEFAULT_BOT_LOGIN = "sovri-bot[bot]";

export type IssueCommentDispatchOctokit = ReReviewOctokit & {
  readonly rest: ReReviewOctokit["rest"] & {
    readonly issues: {
      readonly addLabels: (
        parameters: IssueAddLabelsParameters,
      ) => Promise<{ readonly data: unknown }>;
      readonly createComment: (
        parameters: IssueCommentCreateParameters,
      ) => Promise<{ readonly data: unknown }>;
    };
    readonly pulls: ReReviewOctokit["rest"]["pulls"] & {
      readonly listReviewComments: (
        parameters: PullRequestReviewCommentListParameters,
      ) => Promise<{ readonly data: readonly PullRequestReviewComment[] }>;
    };
    readonly reactions: {
      readonly createForIssueComment: (
        parameters: IssueCommentReactionParameters,
      ) => Promise<{ readonly data: unknown }>;
      readonly createForPullRequestReviewComment: (
        parameters: PullRequestReviewCommentReactionParameters,
      ) => Promise<{ readonly data: unknown }>;
      readonly listForPullRequestReviewComment: (
        parameters: PullRequestReviewCommentReactionListParameters,
      ) => Promise<{ readonly data: readonly PullRequestReviewCommentReaction[] }>;
    };
  };
};

type IssueCommentReactionParameters = {
  readonly comment_id: number;
  readonly content: "+1" | "confused";
  readonly owner: string;
  readonly repo: string;
};

type PullRequestReviewCommentReactionParameters = {
  readonly comment_id: number;
  readonly content: "-1";
  readonly owner: string;
  readonly repo: string;
};

type PullRequestReviewCommentReactionListParameters = {
  readonly comment_id: number;
  readonly owner: string;
  readonly repo: string;
};

type PullRequestReviewCommentReaction = {
  readonly content?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type IssueAddLabelsParameters = {
  readonly issue_number: number;
  readonly labels: string[];
  readonly owner: string;
  readonly repo: string;
};

type IssueCommentCreateParameters = {
  readonly body: string;
  readonly issue_number: number;
  readonly owner: string;
  readonly repo: string;
};

type PullRequestReviewCommentListParameters = {
  readonly owner: string;
  readonly page?: number;
  readonly per_page?: number;
  readonly pull_number: number;
  readonly repo: string;
};

type PullRequestReviewComment = {
  readonly body?: string | null;
  readonly id: number;
};

type PullRequestReview = {
  readonly body?: string | null;
  readonly id: number;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type IssueComment = PullRequestReview;

type RepoRef = {
  readonly owner: string;
  readonly repo: string;
};

const REVIEW_COMMENT_PAGE_SIZE = 100;
const WALKTHROUGH_PAGE_SIZE = 100;
const DISMISSED_FINDING_LABEL = "sovri:dismissed-finding";
const UNAUTHORIZED_DISMISS_BODY = "Only the pull request author can dismiss findings.";
const FindingMarkerPattern = /<!--\s*sovri-finding-id:\s*([A-Za-z0-9-]{1,64})\s*-->/u;
const AlreadyExistsMessagePattern = /already(?:_| )exists/iu;

const PullRequestAuthorSchema = z
  .object({
    user: z
      .object({
        login: z.string().min(1),
      })
      .nullable(),
  })
  .passthrough();

export type IssueCommentDispatchContext = {
  readonly id: string;
  readonly octokit: IssueCommentDispatchOctokit;
  readonly payload: {
    readonly repository: {
      readonly full_name?: string;
    };
  };
};

export function createIssueCommentHandlerDependencies(
  context: IssueCommentDispatchContext,
  env: NodeJS.ProcessEnv = process.env,
): IssueCommentHandlerDependencies {
  const botLogin = readBotLogin(env);
  return {
    botLogin,
    handleDismiss: (command) => handleDismissCommand(context, command, botLogin),
    handleReReview: (command) =>
      handleReReviewCommand(command, createReReviewCommandDependencies(context.octokit, env)),
    parseCommand,
    reactToUnknown: (reaction) => reactConfused(context, reaction),
  };
}

function readBotLogin(env: NodeJS.ProcessEnv): string {
  const value = env.SOVRI_BOT_LOGIN?.trim();
  if (value === undefined || value.length === 0) {
    return DEFAULT_BOT_LOGIN;
  }

  return value;
}

async function reactConfused(
  context: IssueCommentDispatchContext,
  reaction: IssueCommentUnknownReaction,
): Promise<void> {
  const repo = splitRepoFullName(context.payload.repository.full_name);
  await context.octokit.rest.reactions.createForIssueComment({
    comment_id: reaction.commentId,
    content: reaction.content,
    owner: repo.owner,
    repo: repo.repo,
  });
}

async function handleDismissCommand(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  botLogin: string,
): Promise<void> {
  const repo = splitRepoFullName(command.repoFullName);
  const pullRequestAuthorLogin = await resolvePullRequestAuthorLogin(context, command, repo);

  if (command.commentAuthorLogin !== pullRequestAuthorLogin) {
    await context.octokit.rest.issues.createComment({
      body: UNAUTHORIZED_DISMISS_BODY,
      issue_number: command.pullRequestNumber,
      owner: repo.owner,
      repo: repo.repo,
    });
    return;
  }

  const reviewComments = await listReviewCommentsOnAllPages(context, command, repo);
  const findingComment = reviewComments.find((comment) =>
    hasFindingMarker(comment, command.findingId),
  );

  if (findingComment !== undefined) {
    const dismissedFindingIds = await collectBotDismissedFindingIds(
      context,
      repo,
      reviewComments,
      botLogin,
    );
    if (!dismissedFindingIds.has(command.findingId)) {
      await createDismissReaction(context, repo, findingComment.id);
      dismissedFindingIds.add(command.findingId);
    }
    await context.octokit.rest.issues.addLabels({
      issue_number: command.pullRequestNumber,
      labels: [DISMISSED_FINDING_LABEL],
      owner: repo.owner,
      repo: repo.repo,
    });
    await updateWalkthroughReview(context, command, repo, dismissedFindingIds, botLogin);
    await context.octokit.rest.reactions.createForIssueComment({
      comment_id: command.commentId,
      content: "+1",
      owner: repo.owner,
      repo: repo.repo,
    });
    return;
  }

  await context.octokit.rest.issues.createComment({
    body: `Finding \`${command.findingId}\` was not found on this pull request. No review state was changed.`,
    issue_number: command.pullRequestNumber,
    owner: repo.owner,
    repo: repo.repo,
  });
}

async function createDismissReaction(
  context: IssueCommentDispatchContext,
  repo: RepoRef,
  commentId: number,
): Promise<void> {
  try {
    await context.octokit.rest.reactions.createForPullRequestReviewComment({
      comment_id: commentId,
      content: "-1",
      owner: repo.owner,
      repo: repo.repo,
    });
  } catch (error) {
    if (isGithubAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

function isGithubAlreadyExistsError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const status = readNumberProperty(error, "status");
  if (status !== 409 && status !== 422) {
    return false;
  }

  const message =
    error instanceof Error ? error.message : (readStringProperty(error, "message") ?? "");
  return AlreadyExistsMessagePattern.test(message);
}

async function resolvePullRequestAuthorLogin(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
): Promise<string> {
  const response = await context.octokit.rest.pulls.get({
    owner: repo.owner,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const pullRequest = PullRequestAuthorSchema.parse(response.data);

  if (pullRequest.user === null) {
    throw new IssueCommentDispatcherAdapterError("Pull request author is missing");
  }

  return pullRequest.user.login;
}

async function listReviewCommentsOnAllPages(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
): Promise<PullRequestReviewComment[]> {
  return listReviewCommentsPage(context, command, repo, 1);
}

async function listReviewCommentsPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  page: number,
): Promise<PullRequestReviewComment[]> {
  const comments = await context.octokit.rest.pulls.listReviewComments({
    owner: repo.owner,
    page,
    per_page: REVIEW_COMMENT_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });

  if (comments.data.length < REVIEW_COMMENT_PAGE_SIZE) {
    return [...comments.data];
  }

  return [...comments.data, ...(await listReviewCommentsPage(context, command, repo, page + 1))];
}

function hasFindingMarker(comment: PullRequestReviewComment, findingId: string): boolean {
  return extractFindingId(comment.body) === findingId;
}

async function collectBotDismissedFindingIds(
  context: IssueCommentDispatchContext,
  repo: RepoRef,
  comments: readonly PullRequestReviewComment[],
  botLogin: string,
): Promise<Set<string>> {
  const dismissedIds = await Promise.all(
    comments.map(async (comment) => {
      const findingId = extractFindingId(comment.body);
      if (findingId === undefined) {
        return undefined;
      }

      const reactions = await context.octokit.rest.reactions.listForPullRequestReviewComment({
        comment_id: comment.id,
        owner: repo.owner,
        repo: repo.repo,
      });

      const botDismissed = reactions.data.some(
        (reaction) => reaction.content === "-1" && reaction.user?.login === botLogin,
      );
      return botDismissed ? findingId : undefined;
    }),
  );

  return new Set(dismissedIds.filter(isDefined));
}

async function updateWalkthroughReview(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  dismissedFindingIds: ReadonlySet<string>,
  botLogin: string,
): Promise<void> {
  const walkthrough = await findMarkedWalkthroughReview(context, command, repo, botLogin);
  if (walkthrough?.body !== undefined && walkthrough.body !== null) {
    const body = renderWalkthroughWithoutDismissedFindings(walkthrough.body, dismissedFindingIds);
    if (body === walkthrough.body) {
      return;
    }

    await context.octokit.rest.pulls.updateReview({
      body,
      owner: repo.owner,
      pull_number: command.pullRequestNumber,
      repo: repo.repo,
      review_id: walkthrough.id,
    });
    return;
  }

  const fallback = await findMarkedWalkthroughIssueComment(context, command, repo, botLogin);
  if (fallback?.body === undefined || fallback.body === null) {
    return;
  }

  const body = renderWalkthroughWithoutDismissedFindings(fallback.body, dismissedFindingIds);
  if (body === fallback.body) {
    return;
  }

  await context.octokit.rest.issues.updateComment({
    body,
    comment_id: fallback.id,
    owner: repo.owner,
    repo: repo.repo,
  });
}

async function findMarkedWalkthroughReview(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
): Promise<PullRequestReview | undefined> {
  return findMarkedWalkthroughReviewPage(context, command, repo, botLogin, 1);
}

async function findMarkedWalkthroughReviewPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
  page: number,
): Promise<PullRequestReview | undefined> {
  const reviews = await context.octokit.rest.pulls.listReviews({
    owner: repo.owner,
    page,
    per_page: WALKTHROUGH_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const match = reviews.data.find(
    (review) =>
      typeof review.body === "string" &&
      review.body.includes(WALKTHROUGH_MARKER) &&
      review.user?.login === botLogin,
  );

  if (match !== undefined) {
    return match;
  }

  if (reviews.data.length < WALKTHROUGH_PAGE_SIZE) {
    return undefined;
  }

  return findMarkedWalkthroughReviewPage(context, command, repo, botLogin, page + 1);
}

async function findMarkedWalkthroughIssueComment(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
): Promise<IssueComment | undefined> {
  return findMarkedWalkthroughIssueCommentPage(context, command, repo, botLogin, 1);
}

async function findMarkedWalkthroughIssueCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
  page: number,
): Promise<IssueComment | undefined> {
  const comments = await context.octokit.rest.issues.listComments({
    issue_number: command.pullRequestNumber,
    owner: repo.owner,
    page,
    per_page: WALKTHROUGH_PAGE_SIZE,
    repo: repo.repo,
  });
  const match = comments.data.find(
    (comment) =>
      typeof comment.body === "string" &&
      comment.body.includes(WALKTHROUGH_MARKER) &&
      comment.user?.login === botLogin,
  );

  if (match !== undefined) {
    return match;
  }

  if (comments.data.length < WALKTHROUGH_PAGE_SIZE) {
    return undefined;
  }

  return findMarkedWalkthroughIssueCommentPage(context, command, repo, botLogin, page + 1);
}

function renderWalkthroughWithoutDismissedFindings(
  body: string,
  dismissedFindingIds: ReadonlySet<string>,
): string {
  return body
    .split("\n")
    .filter((line) => {
      const findingId = extractFindingId(line);
      return findingId === undefined || !dismissedFindingIds.has(findingId);
    })
    .join("\n");
}

function extractFindingId(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return FindingMarkerPattern.exec(value)?.[1];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumberProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): number | undefined {
  const value = record[property];
  return typeof value === "number" ? value : undefined;
}

function readStringProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}

function splitRepoFullName(repoFullName: string | undefined): {
  readonly owner: string;
  readonly repo: string;
} {
  if (repoFullName === undefined) {
    throw new IssueCommentDispatcherAdapterError("Repository full name is missing");
  }

  const parts = repoFullName.split("/");
  const owner = parts[0];
  const repo = parts[1];

  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    owner.length === 0 ||
    repo.length === 0
  ) {
    throw new IssueCommentDispatcherAdapterError("Repository full name is invalid");
  }

  return { owner, repo };
}

class IssueCommentDispatcherAdapterError extends Error {
  public override readonly name = "IssueCommentDispatcherAdapterError";
}
