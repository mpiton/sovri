// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

import type { IssueCommentCommandContext } from "../../handlers/issue-comment.js";
import {
  handlePullRequestSynchronize,
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
  };
};

export type ReReviewCommandDependencies = {
  readonly createPullRequestDependencies: (
    context: PullRequestWebhookContext,
  ) => PullRequestHandlerDependencies;
  readonly octokit: ReReviewOctokit;
};

type PullRequestGetParameters = {
  readonly owner: string;
  readonly pull_number: number;
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
  };
}

export async function handleReReviewCommand(
  command: IssueCommentCommandContext,
  dependencies: ReReviewCommandDependencies,
): Promise<void> {
  const repo = splitRepoFullName(command.repoFullName);
  const response = await dependencies.octokit.rest.pulls.get({
    owner: repo.owner,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const pullRequest = PullRequestGetSchema.parse(response.data);
  const context = buildPullRequestContext(command, dependencies.octokit, pullRequest);
  await handlePullRequestSynchronize(context, dependencies.createPullRequestDependencies(context));
}

function buildPullRequestContext(
  command: IssueCommentCommandContext,
  octokit: ReReviewOctokit,
  pullRequest: z.infer<typeof PullRequestGetSchema>,
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

class ReReviewCommandError extends Error {
  public override readonly name = "ReReviewCommandError";
}
