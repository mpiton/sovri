// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import type { IssueCommentCommandContext } from "../../handlers/issue-comment.js";
import {
  handlePullRequestSynchronize,
  reportPullRequestReviewFailure,
  type PullRequestHandlerDependencies,
  type PullRequestOctokit,
  type PullRequestWebhookContext,
} from "../../handlers/pull-request.js";
import { createPullRequestHandlerDependencies } from "../../github/pull-request-review.js";

export type ReReviewOctokit = PullRequestOctokit & {
  readonly rest: PullRequestOctokit["rest"] & {
    readonly pulls: PullRequestOctokit["rest"]["pulls"] & {
      readonly get: (parameters: PullRequestGetParameters) => Promise<{ readonly data: unknown }>;
    };
    readonly reactions: {
      readonly createForIssueComment: (
        parameters: AcceptedReactionParameters,
      ) => Promise<{ readonly data: unknown }>;
    };
  };
};

export type ReReviewCommandDependencies = {
  readonly createPullRequestDependencies: (
    context: PullRequestWebhookContext,
  ) => PullRequestHandlerDependencies;
  readonly octokit: ReReviewOctokit;
  readonly reactToAccepted: (reaction: ReReviewAcceptedReaction) => Promise<void>;
};

export type ReReviewAcceptedReaction = {
  readonly commentId: number;
  readonly content: "+1";
  readonly repoFullName: string;
};

type PullRequestGetParameters = {
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
};

type AcceptedReactionParameters = {
  readonly comment_id: number;
  readonly content: "+1";
  readonly owner: string;
  readonly repo: string;
};

const PullRequestGetSchema = z
  .object({
    additions: z.number().int().nonnegative(),
    base: z.object({
      ref: z.string().min(1),
      sha: z.string().length(40),
    }),
    body: z.string().nullable(),
    changed_files: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    draft: z.boolean().default(false),
    head: z.object({
      ref: z.string().min(1),
      sha: z.string().length(40),
    }),
    number: z.number().int().positive(),
    title: z.string().min(1),
    user: z
      .object({
        login: z.string().min(1),
      })
      .nullable(),
  })
  .passthrough();

export function createReReviewCommandDependencies(
  octokit: ReReviewOctokit,
  env: NodeJS.ProcessEnv = process.env,
): ReReviewCommandDependencies {
  return {
    createPullRequestDependencies: (context) => createPullRequestHandlerDependencies(context, env),
    octokit,
    reactToAccepted: (reaction) => reactAccepted(octokit, reaction),
  };
}

export async function handleReReviewCommand(
  command: IssueCommentCommandContext,
  dependencies: ReReviewCommandDependencies,
): Promise<void> {
  const pullRequest = await resolvePullRequest(command, dependencies);
  if (pullRequest === undefined) {
    return;
  }

  const context = buildPullRequestContext(command, dependencies.octokit, pullRequest);
  const pullRequestDependencies = dependencies.createPullRequestDependencies(context);
  await tryReactToAccepted(command, dependencies, pullRequestDependencies);
  await handlePullRequestSynchronize(context, pullRequestDependencies);
}

async function reactAccepted(
  octokit: ReReviewOctokit,
  reaction: ReReviewAcceptedReaction,
): Promise<void> {
  const repo = splitRepoFullName(reaction.repoFullName);
  await octokit.rest.reactions.createForIssueComment({
    comment_id: reaction.commentId,
    content: reaction.content,
    owner: repo.owner,
    repo: repo.repo,
  });
}

async function tryReactToAccepted(
  command: IssueCommentCommandContext,
  dependencies: ReReviewCommandDependencies,
  pullRequestDependencies: PullRequestHandlerDependencies,
): Promise<void> {
  try {
    await dependencies.reactToAccepted({
      commentId: command.commentId,
      content: "+1",
      repoFullName: command.repoFullName,
    });
  } catch (error) {
    pullRequestDependencies.logger.error(
      {
        delivery_id: command.correlationId,
        error_message: errorMessageFrom(error),
        pr_number: command.pullRequestNumber,
        repo: command.repoFullName,
      },
      "Accepted re-review reaction failed",
    );
  }
}

async function resolvePullRequest(
  command: IssueCommentCommandContext,
  dependencies: ReReviewCommandDependencies,
): Promise<z.infer<typeof PullRequestGetSchema> | undefined> {
  try {
    const repo = splitRepoFullName(command.repoFullName);
    const response = await dependencies.octokit.rest.pulls.get({
      owner: repo.owner,
      pull_number: command.pullRequestNumber,
      repo: repo.repo,
    });

    return PullRequestGetSchema.parse(response.data);
  } catch (error) {
    await reportReReviewResolutionFailure(command, dependencies, error);
    return undefined;
  }
}

async function reportReReviewResolutionFailure(
  command: IssueCommentCommandContext,
  dependencies: ReReviewCommandDependencies,
  error: unknown,
): Promise<void> {
  const context = buildPullRequestContext(command, dependencies.octokit, {
    number: command.pullRequestNumber,
  });
  await reportPullRequestReviewFailure({
    commentTarget: {
      number: command.pullRequestNumber,
      repoFullName: command.repoFullName,
    },
    dependencies: dependencies.createPullRequestDependencies(context),
    error,
    failureStage: "review_engine",
    logContext: {
      delivery_id: command.correlationId,
      event: context.name,
      pr_number: command.pullRequestNumber,
      repo: command.repoFullName,
    },
  });
}

function buildPullRequestContext(
  command: IssueCommentCommandContext,
  octokit: ReReviewOctokit,
  pullRequest: PullRequestWebhookContext["payload"]["pull_request"],
): PullRequestWebhookContext {
  return {
    id: command.correlationId,
    name: "pull_request.synchronize",
    octokit,
    payload: {
      action: "synchronize",
      pull_request: pullRequest,
      repository: {
        full_name: command.repoFullName,
      },
    },
  };
}

function splitRepoFullName(repoFullName: string): {
  readonly owner: string;
  readonly repo: string;
} {
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
    throw new ReReviewCommandError("Repository full name is invalid");
  }

  return { owner, repo };
}

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown reaction failure";
}

class ReReviewCommandError extends Error {
  public override readonly name = "ReReviewCommandError";
}
