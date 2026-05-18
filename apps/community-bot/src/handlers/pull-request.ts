// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { SovriConfig } from "@sovri/config";
import type {
  Diff,
  Review,
  ReviewPullRequestInput,
  ReviewPullRequestOptions,
} from "@sovri/review-engine";

export type PullRequestWebhookContext = {
  readonly id: string;
  readonly name: string;
  readonly octokit: unknown;
  readonly payload: {
    readonly action: string;
    readonly pull_request: PullRequestPayload;
    readonly repository: {
      readonly full_name: string;
    };
  };
};

export type ReviewPostTarget = {
  readonly commitSha: string;
  readonly number: number;
  readonly repoFullName: string;
};

export type PullRequestHandlerLogger = {
  error(message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
  info(message: string): void;
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

export type PullRequestHandlerDependencies = {
  readonly fetchDiff: (target: ReviewPostTarget) => Promise<Diff>;
  readonly loadConfig: (target: ReviewPostTarget) => Promise<SovriConfig>;
  readonly logger: PullRequestHandlerLogger;
  readonly postErrorComment: (target: ReviewPostTarget, message: string) => Promise<void>;
  readonly postReview: (target: ReviewPostTarget, review: Review) => Promise<void>;
  readonly reviewPullRequest: (
    input: ReviewPullRequestInput,
    options: ReviewPullRequestOptions,
  ) => Promise<Review>;
  readonly reviewOptions?: ReviewPullRequestOptions;
};

type PullRequestPayload = {
  readonly additions: number;
  readonly base: {
    readonly ref: string;
    readonly sha: string;
  };
  readonly body: string | null;
  readonly changed_files: number;
  readonly deletions: number;
  readonly draft: boolean;
  readonly head: {
    readonly ref: string;
    readonly sha: string;
  };
  readonly number: number;
  readonly title: string;
  readonly user: {
    readonly login: string;
  };
};

const DefaultReviewOptions: ReviewPullRequestOptions = {
  provider: {
    maxTokens: 1,
    model: "unconfigured",
    name: "unconfigured",
    async generateStructured<T>(): Promise<T> {
      throw new PullRequestHandlerDependencyError("LLM provider is not configured");
    },
  },
};

class PullRequestHandlerDependencyError extends Error {
  public override readonly name = "PullRequestHandlerDependencyError";
}

export async function handlePullRequestOpened(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  await handlePullRequest(context, dependencies);
}

export async function handlePullRequestSynchronize(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  await handlePullRequest(context, dependencies);
}

async function handlePullRequest(
  context: PullRequestWebhookContext,
  dependencies: PullRequestHandlerDependencies,
): Promise<void> {
  const target = buildTarget(context);
  dependencies.logger.info(
    {
      delivery_id: context.id,
      event: context.name,
      pr_number: target.number,
      repo: target.repoFullName,
    },
    "Pull request review started",
  );

  const config = await dependencies.loadConfig(target);
  const diff = await dependencies.fetchDiff(target);
  const review = await dependencies.reviewPullRequest(
    {
      config,
      diff,
      pullRequest: buildPullRequest(context),
    },
    dependencies.reviewOptions ?? DefaultReviewOptions,
  );
  await dependencies.postReview(target, review);
}

function buildTarget(context: PullRequestWebhookContext): ReviewPostTarget {
  return {
    commitSha: context.payload.pull_request.head.sha,
    number: context.payload.pull_request.number,
    repoFullName: context.payload.repository.full_name,
  };
}

function buildPullRequest(
  context: PullRequestWebhookContext,
): ReviewPullRequestInput["pullRequest"] {
  const pullRequest = context.payload.pull_request;
  return {
    additions: pullRequest.additions,
    author: pullRequest.user.login,
    base_ref: pullRequest.base.ref,
    base_sha: pullRequest.base.sha,
    body: pullRequest.body,
    changed_files: pullRequest.changed_files,
    deletions: pullRequest.deletions,
    draft: pullRequest.draft,
    head_ref: pullRequest.head.ref,
    head_sha: pullRequest.head.sha,
    number: pullRequest.number,
    repo_full_name: context.payload.repository.full_name,
    title: pullRequest.title,
  };
}
