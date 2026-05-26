// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

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

const DEFAULT_BOT_LOGIN = "sovri-bot[bot]";

export type IssueCommentDispatchOctokit = ReReviewOctokit & {
  readonly rest: ReReviewOctokit["rest"] & {
    readonly issues: {
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
        parameters: ReactionParameters,
      ) => Promise<{ readonly data: unknown }>;
    };
  };
};

type ReactionParameters = {
  readonly comment_id: number;
  readonly content: "+1" | "confused";
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
};

const REVIEW_COMMENT_PAGE_SIZE = 100;

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
  return {
    botLogin: readBotLogin(env),
    handleDismiss: (command) => reportUnknownFinding(context, command),
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

async function reportUnknownFinding(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
): Promise<void> {
  const repo = splitRepoFullName(command.repoFullName);

  if (await hasFindingMarkerOnAnyReviewCommentPage(context, command, repo)) {
    return;
  }

  await context.octokit.rest.issues.createComment({
    body: `Finding \`${command.findingId}\` was not found on this pull request. No review state was changed.`,
    issue_number: command.pullRequestNumber,
    owner: repo.owner,
    repo: repo.repo,
  });
}

async function hasFindingMarkerOnAnyReviewCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: { readonly owner: string; readonly repo: string },
): Promise<boolean> {
  return hasFindingMarkerOnReviewCommentPage(context, command, repo, 1);
}

async function hasFindingMarkerOnReviewCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: { readonly owner: string; readonly repo: string },
  page: number,
): Promise<boolean> {
  const comments = await context.octokit.rest.pulls.listReviewComments({
    owner: repo.owner,
    page,
    per_page: REVIEW_COMMENT_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });

  if (comments.data.some((comment) => hasFindingMarker(comment, command.findingId))) {
    return true;
  }

  if (comments.data.length < REVIEW_COMMENT_PAGE_SIZE) {
    return false;
  }

  return hasFindingMarkerOnReviewCommentPage(context, command, repo, page + 1);
}

function hasFindingMarker(comment: PullRequestReviewComment, findingId: string): boolean {
  return comment.body?.includes(`<!-- sovri-finding-id: ${findingId} -->`) ?? false;
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
