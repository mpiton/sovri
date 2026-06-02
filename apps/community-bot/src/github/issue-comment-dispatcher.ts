// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { createLogger } from "@sovri/observability";

import {
  createReReviewCommandDependencies,
  handleReReviewCommand,
  type ReReviewOctokit,
} from "../commands/handlers/re-review.js";
import { handleResolveCommand } from "../commands/handlers/resolve.js";
import { parseCommand } from "../commands/parser.js";
import {
  FindingMarkerPattern,
  githubStatusFrom,
  isGithubAlreadyExistsError,
  splitRepoFullName,
  type RepoRef,
} from "../commands/shared-utilities.js";
import type {
  IssueCommentDismissCommandContext,
  IssueCommentHandlerDependencies,
  IssueCommentUnknownReaction,
} from "../handlers/issue-comment.js";
import { WALKTHROUGH_MARKER } from "./comment-poster.js";

const DEFAULT_BOT_LOGIN = "sovri-bot[bot]";
const logger = createLogger("community-bot.issue-comment");

export type IssueCommentDispatchOctokit = ReReviewOctokit & {
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
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
      readonly listForIssueComment: (
        parameters: IssueCommentReactionListParameters,
      ) => Promise<{ readonly data: readonly IssueCommentReaction[] }>;
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

type IssueCommentReactionListParameters = {
  readonly comment_id: number;
  readonly owner: string;
  readonly page?: number;
  readonly per_page?: number;
  readonly repo: string;
};

type IssueCommentReaction = {
  readonly content?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
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
  readonly page?: number;
  readonly per_page?: number;
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
  readonly node_id?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type PullRequestReview = {
  readonly body?: string | null;
  readonly id: number;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type IssueComment = PullRequestReview;

type IssueCommentDispatchLogger = {
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

const REVIEW_COMMENT_PAGE_SIZE = 100;
const WALKTHROUGH_PAGE_SIZE = 100;
const REACTION_PAGE_SIZE = 100;
const DISMISSED_FINDING_LABEL = "sovri:dismissed-finding";
const DISMISS_FAILURE_BODY = "Dismiss command could not be completed. Please retry later.";
const NO_FINDINGS_LINE = "No findings.";
const UNAUTHORIZED_DISMISS_BODY = "Only the pull request author can dismiss findings.";

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
  dispatchLogger: IssueCommentDispatchLogger = logger,
): IssueCommentHandlerDependencies {
  const botLogin = readBotLogin(env);
  return {
    botLogin,
    handleDismiss: (command) => handleDismissCommand(context, command, botLogin, dispatchLogger),
    handleReReview: (command) =>
      handleReReviewCommand(command, createReReviewCommandDependencies(context.octokit, env)),
    handleResolve: (command) => handleResolveCommand(context, command, botLogin, dispatchLogger),
    parseCommand,
    reactToUnknown: (reaction) => reactConfused(context, reaction),
  };
}

export function readBotLogin(env: NodeJS.ProcessEnv): string {
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
  const repo = splitRepoFullName(
    context.payload.repository.full_name,
    createIssueCommentDispatcherAdapterError,
  );
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
  dispatchLogger: IssueCommentDispatchLogger,
): Promise<void> {
  const logContext = buildDismissLogContext(command);
  dispatchLogger.info(logContext, "Dismiss command started");
  const repo = splitRepoFullName(command.repoFullName, createIssueCommentDispatcherAdapterError);
  try {
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
    const botReviewComments = reviewComments.filter((comment) => comment.user?.login === botLogin);
    const findingComment = botReviewComments.find((comment) =>
      hasFindingMarker(comment, command.findingId),
    );

    if (findingComment !== undefined) {
      const dismissedFindingIds = await collectBotDismissedFindingIds(
        context,
        repo,
        botReviewComments,
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
      dispatchLogger.info({ ...logContext, result: "success" }, "Dismiss command completed");
      return;
    }

    await context.octokit.rest.issues.createComment({
      body: `Finding \`${command.findingId}\` was not found on this pull request. No review state was changed.`,
      issue_number: command.pullRequestNumber,
      owner: repo.owner,
      repo: repo.repo,
    });
  } catch (error) {
    dispatchLogger.error(buildDismissErrorLogContext(logContext, error), "Dismiss command failed");
    await context.octokit.rest.issues.createComment({
      body: DISMISS_FAILURE_BODY,
      issue_number: command.pullRequestNumber,
      owner: repo.owner,
      repo: repo.repo,
    });
  }
}

function buildDismissLogContext(
  command: IssueCommentDismissCommandContext,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: command.correlationId,
    pr_number: command.pullRequestNumber,
    repo: command.repoFullName,
  };
}

function buildDismissErrorLogContext(
  logContext: Readonly<Record<string, unknown>>,
  error: unknown,
): Readonly<Record<string, unknown>> {
  const status = githubStatusFrom(error);
  if (status === undefined) {
    return logContext;
  }

  return {
    ...logContext,
    github_status: status,
  };
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
  return collectBotDismissedFindingIdsFromIndex(context, repo, comments, botLogin, 0, new Set());
}

async function collectBotDismissedFindingIdsFromIndex(
  context: IssueCommentDispatchContext,
  repo: RepoRef,
  comments: readonly PullRequestReviewComment[],
  botLogin: string,
  index: number,
  accumulator: Set<string>,
): Promise<Set<string>> {
  if (index >= comments.length) {
    return accumulator;
  }

  const comment = comments[index];
  if (comment === undefined) {
    return collectBotDismissedFindingIdsFromIndex(
      context,
      repo,
      comments,
      botLogin,
      index + 1,
      accumulator,
    );
  }

  const findingId = extractFindingId(comment.body);
  if (findingId !== undefined) {
    const botDismissed = await hasBotDismissReaction(context, repo, comment.id, botLogin);
    if (botDismissed) {
      accumulator.add(findingId);
    }
  }

  return collectBotDismissedFindingIdsFromIndex(
    context,
    repo,
    comments,
    botLogin,
    index + 1,
    accumulator,
  );
}

async function hasBotDismissReaction(
  context: IssueCommentDispatchContext,
  repo: RepoRef,
  commentId: number,
  botLogin: string,
): Promise<boolean> {
  return hasBotDismissReactionPage(context, repo, commentId, botLogin, 1);
}

async function hasBotDismissReactionPage(
  context: IssueCommentDispatchContext,
  repo: RepoRef,
  commentId: number,
  botLogin: string,
  page: number,
): Promise<boolean> {
  const reactions = await context.octokit.rest.reactions.listForPullRequestReviewComment({
    comment_id: commentId,
    owner: repo.owner,
    page,
    per_page: REACTION_PAGE_SIZE,
    repo: repo.repo,
  });

  const botDismissed = reactions.data.some(
    (reaction) => reaction.content === "-1" && reaction.user?.login === botLogin,
  );
  if (botDismissed) {
    return true;
  }

  if (reactions.data.length < REACTION_PAGE_SIZE) {
    return false;
  }

  return hasBotDismissReactionPage(context, repo, commentId, botLogin, page + 1);
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
  return findMarkedWalkthroughReviewPage(context, command, repo, botLogin, 1, undefined);
}

async function findMarkedWalkthroughReviewPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
  page: number,
  latest: PullRequestReview | undefined,
): Promise<PullRequestReview | undefined> {
  const reviews = await context.octokit.rest.pulls.listReviews({
    owner: repo.owner,
    page,
    per_page: WALKTHROUGH_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const newLatest = reviews.data.reduce<PullRequestReview | undefined>(
    (acc, review) =>
      typeof review.body === "string" &&
      review.body.includes(WALKTHROUGH_MARKER) &&
      review.user?.login === botLogin
        ? review
        : acc,
    latest,
  );

  if (reviews.data.length < WALKTHROUGH_PAGE_SIZE) {
    return newLatest;
  }

  return findMarkedWalkthroughReviewPage(context, command, repo, botLogin, page + 1, newLatest);
}

async function findMarkedWalkthroughIssueComment(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
): Promise<IssueComment | undefined> {
  return findMarkedWalkthroughIssueCommentPage(context, command, repo, botLogin, 1, undefined);
}

async function findMarkedWalkthroughIssueCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
  page: number,
  latest: IssueComment | undefined,
): Promise<IssueComment | undefined> {
  const comments = await context.octokit.rest.issues.listComments({
    issue_number: command.pullRequestNumber,
    owner: repo.owner,
    page,
    per_page: WALKTHROUGH_PAGE_SIZE,
    repo: repo.repo,
  });
  const newLatest = comments.data.reduce<IssueComment | undefined>(
    (acc, comment) =>
      typeof comment.body === "string" &&
      comment.body.includes(WALKTHROUGH_MARKER) &&
      comment.user?.login === botLogin
        ? comment
        : acc,
    latest,
  );

  if (comments.data.length < WALKTHROUGH_PAGE_SIZE) {
    return newLatest;
  }

  return findMarkedWalkthroughIssueCommentPage(
    context,
    command,
    repo,
    botLogin,
    page + 1,
    newLatest,
  );
}

function renderWalkthroughWithoutDismissedFindings(
  body: string,
  dismissedFindingIds: ReadonlySet<string>,
): string {
  const lines = body.split("\n").filter((line) => {
    const findingId = extractFindingId(line);
    return findingId === undefined || !dismissedFindingIds.has(findingId);
  });

  if (hasVisibleFinding(lines) || lines.some((line) => line.trim() === NO_FINDINGS_LINE)) {
    return lines.join("\n");
  }

  return insertNoFindingsLine(lines).join("\n");
}

function extractFindingId(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return FindingMarkerPattern.exec(value)?.[1];
}

function hasVisibleFinding(lines: readonly string[]): boolean {
  return lines.some((line) => extractFindingId(line) !== undefined);
}

function insertNoFindingsLine(lines: readonly string[]): string[] {
  const findingsHeadingIndex = lines.findIndex((line) => line.trim() === "### Findings");
  if (findingsHeadingIndex === -1) {
    return [NO_FINDINGS_LINE, "", ...lines];
  }

  let insertionIndex = findingsHeadingIndex + 1;
  while (lines[insertionIndex]?.trim() === "") {
    insertionIndex += 1;
  }

  return [...lines.slice(0, insertionIndex), NO_FINDINGS_LINE, "", ...lines.slice(insertionIndex)];
}

class IssueCommentDispatcherAdapterError extends Error {
  public override readonly name = "IssueCommentDispatcherAdapterError";
}

function createIssueCommentDispatcherAdapterError(
  message: string,
): IssueCommentDispatcherAdapterError {
  return new IssueCommentDispatcherAdapterError(message);
}
