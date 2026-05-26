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

const REVIEW_COMMENT_PAGE_SIZE = 100;
const DISMISSED_FINDING_LABEL = "sovri:dismissed-finding";
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
): IssueCommentHandlerDependencies {
  return {
    botLogin: readBotLogin(env),
    handleDismiss: (command) => handleDismissCommand(context, command),
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

  const findingComment = await findFindingCommentOnAnyReviewCommentPage(context, command, repo);

  if (findingComment !== undefined) {
    await context.octokit.rest.reactions.createForPullRequestReviewComment({
      comment_id: findingComment.id,
      content: "-1",
      owner: repo.owner,
      repo: repo.repo,
    });
    await context.octokit.rest.issues.addLabels({
      issue_number: command.pullRequestNumber,
      labels: [DISMISSED_FINDING_LABEL],
      owner: repo.owner,
      repo: repo.repo,
    });
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

async function resolvePullRequestAuthorLogin(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: { readonly owner: string; readonly repo: string },
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

async function findFindingCommentOnAnyReviewCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: { readonly owner: string; readonly repo: string },
): Promise<PullRequestReviewComment | undefined> {
  return findFindingCommentOnReviewCommentPage(context, command, repo, 1);
}

async function findFindingCommentOnReviewCommentPage(
  context: IssueCommentDispatchContext,
  command: IssueCommentDismissCommandContext,
  repo: { readonly owner: string; readonly repo: string },
  page: number,
): Promise<PullRequestReviewComment | undefined> {
  const comments = await context.octokit.rest.pulls.listReviewComments({
    owner: repo.owner,
    page,
    per_page: REVIEW_COMMENT_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const findingComment = comments.data.find((comment) =>
    hasFindingMarker(comment, command.findingId),
  );

  if (findingComment !== undefined) {
    return findingComment;
  }

  if (comments.data.length < REVIEW_COMMENT_PAGE_SIZE) {
    return undefined;
  }

  return findFindingCommentOnReviewCommentPage(context, command, repo, page + 1);
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
