// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { SovriConfig } from "@sovri/config";
import { MissingApiKeyError } from "@sovri/llm-providers";
import type {
  Diff,
  Review,
  ReviewPullRequestInput,
  ReviewPullRequestOptions,
} from "@sovri/review-engine";
import type { CommentPosterOctokit } from "../github/comment-poster.js";
import type { DiffFetcherOctokit } from "../github/diff-fetcher.js";
import { DeploymentConfigError } from "../runtime-env.js";

export type PullRequestWebhookContext = {
  readonly id: string;
  readonly name: string;
  readonly octokit: PullRequestOctokit;
  readonly payload: {
    readonly action: string;
    readonly pull_request: PullRequestPayload;
    readonly repository: {
      readonly full_name?: string;
    };
  };
};

export type PullRequestOctokit = CommentPosterOctokit &
  DiffFetcherOctokit & {
    readonly rest: {
      readonly repos: {
        readonly getContent: (
          parameters: RepositoryContentParameters,
        ) => Promise<{ readonly data: unknown }>;
      };
    };
  };

type RepositoryContentParameters = {
  readonly mediaType: {
    readonly format: "raw";
  };
  readonly owner: string;
  readonly path: ".sovri.yml";
  readonly ref: string;
  readonly repo: string;
};

export type ReviewCommentTarget = {
  readonly number: number;
  readonly repoFullName: string;
};

export type ReviewPostTarget = ReviewCommentTarget & {
  readonly baseSha: string;
  readonly commitSha: string;
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
  readonly postErrorComment: (target: ReviewCommentTarget, message: string) => Promise<void>;
  readonly postReview: (target: ReviewPostTarget, review: Review, diff: Diff) => Promise<void>;
  readonly reviewPullRequest: (
    input: ReviewPullRequestInput,
    options: ReviewPullRequestOptions,
  ) => Promise<Review>;
  readonly buildReviewOptions?: (config: SovriConfig) => ReviewPullRequestOptions;
  readonly reviewOptions?: ReviewPullRequestOptions;
};

export type PullRequestFailureReporterDependencies = Pick<
  PullRequestHandlerDependencies,
  "logger" | "postErrorComment"
>;

type PullRequestPayload = {
  readonly additions?: number;
  readonly base?: {
    readonly ref?: string;
    readonly sha?: string;
  };
  readonly body?: string | null;
  readonly changed_files?: number;
  readonly deletions?: number;
  readonly draft?: boolean;
  readonly head?: {
    readonly ref?: string;
    readonly sha?: string;
  };
  readonly number?: number;
  readonly title?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
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

class PullRequestReviewFailedError extends Error {
  public override readonly name = "PullRequestReviewFailedError";
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
  const initialLogContext = buildInitialLogContext(context);
  const commentTarget = buildOptionalCommentTarget(context);
  dependencies.logger.info(initialLogContext, "Pull request review started");

  let target: ReviewPostTarget | undefined;
  try {
    target = buildTarget(context);
    const logContext = buildLogContext(context, target);
    const config = await dependencies.loadConfig(target);
    if ((context.payload.pull_request.draft ?? false) && !config.review.autoReviewDrafts) {
      dependencies.logger.info(
        {
          ...logContext,
          draft: true,
        },
        "Pull request review skipped",
      );
      return;
    }

    const diff = await dependencies.fetchDiff(target);
    const reviewOptions =
      dependencies.buildReviewOptions?.(config) ??
      dependencies.reviewOptions ??
      DefaultReviewOptions;
    const review = await dependencies.reviewPullRequest(
      {
        config,
        diff,
        pullRequest: buildPullRequest(context),
      },
      reviewOptions,
    );
    requireSuccessfulReview(review);
    await dependencies.postReview(target, review, diff);
    dependencies.logger.info(
      {
        ...logContext,
        result: review.status,
      },
      "Pull request review completed",
    );
  } catch (error) {
    await reportReviewFailure({
      commentTarget: target ?? commentTarget,
      dependencies,
      error,
      logContext: target === undefined ? initialLogContext : buildLogContext(context, target),
    });
  }
}

function buildTarget(context: PullRequestWebhookContext): ReviewPostTarget {
  const pullRequest = context.payload.pull_request;
  return {
    baseSha: requireString(pullRequest.base?.sha, "pull_request.base.sha"),
    commitSha: requireString(pullRequest.head?.sha, "pull_request.head.sha"),
    number: requireNumber(pullRequest.number, "pull_request.number"),
    repoFullName: requireString(context.payload.repository.full_name, "repository.full_name"),
  };
}

function buildPullRequest(
  context: PullRequestWebhookContext,
): ReviewPullRequestInput["pullRequest"] {
  const pullRequest = context.payload.pull_request;
  return {
    additions: requireNumber(pullRequest.additions, "pull_request.additions"),
    author: requireString(pullRequest.user?.login, "pull_request.user.login"),
    base_ref: requireString(pullRequest.base?.ref, "pull_request.base.ref"),
    base_sha: requireString(pullRequest.base?.sha, "pull_request.base.sha"),
    body: pullRequest.body ?? null,
    changed_files: requireNumber(pullRequest.changed_files, "pull_request.changed_files"),
    deletions: requireNumber(pullRequest.deletions, "pull_request.deletions"),
    draft: pullRequest.draft ?? false,
    head_ref: requireString(pullRequest.head?.ref, "pull_request.head.ref"),
    head_sha: requireString(pullRequest.head?.sha, "pull_request.head.sha"),
    number: requireNumber(pullRequest.number, "pull_request.number"),
    repo_full_name: requireString(context.payload.repository.full_name, "repository.full_name"),
    title: requireString(pullRequest.title, "pull_request.title"),
  };
}

function requireSuccessfulReview(review: Review): void {
  if (review.status !== "failed") {
    return;
  }

  throw new PullRequestReviewFailedError(review.error ?? review.summary);
}

function buildInitialLogContext(
  context: PullRequestWebhookContext,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: context.id,
    event: context.name,
    pr_number: context.payload.pull_request.number,
    repo: context.payload.repository.full_name,
  };
}

function buildOptionalCommentTarget(
  context: PullRequestWebhookContext,
): ReviewCommentTarget | undefined {
  const number = context.payload.pull_request.number;
  const repoFullName = context.payload.repository.full_name;
  if (number === undefined || repoFullName === undefined || repoFullName.length === 0) {
    return undefined;
  }

  return {
    number,
    repoFullName,
  };
}

function buildLogContext(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: context.id,
    event: context.name,
    pr_number: target.number,
    repo: target.repoFullName,
  };
}

async function reportReviewFailure(values: {
  readonly commentTarget: ReviewCommentTarget | undefined;
  readonly dependencies: PullRequestFailureReporterDependencies;
  readonly error: unknown;
  readonly logContext: Readonly<Record<string, unknown>>;
}): Promise<void> {
  const failure = describeReviewFailure(values.error);
  const commentErrorMessage =
    values.commentTarget === undefined
      ? "review comment target is unavailable"
      : await tryPostFailureComment(
          values.dependencies,
          values.commentTarget,
          failure.commentMessage,
        );

  values.dependencies.logger.error(
    {
      ...values.logContext,
      comment_error_message: commentErrorMessage,
      ...failure.logFields,
    },
    "Pull request review failed",
  );
}

export async function reportPullRequestReviewFailure(values: {
  readonly commentTarget: ReviewCommentTarget | undefined;
  readonly dependencies: PullRequestFailureReporterDependencies;
  readonly error: unknown;
  readonly logContext: Readonly<Record<string, unknown>>;
}): Promise<void> {
  await reportReviewFailure(values);
}

async function tryPostFailureComment(
  dependencies: PullRequestFailureReporterDependencies,
  target: ReviewCommentTarget,
  message: string,
): Promise<string | undefined> {
  try {
    await dependencies.postErrorComment(target, message);
    return undefined;
  } catch (error) {
    return errorMessageFrom(error);
  }
}

function describeReviewFailure(error: unknown): {
  readonly commentMessage: string;
  readonly logFields: Readonly<Record<string, unknown>>;
} {
  if (error instanceof MissingApiKeyError) {
    return {
      commentMessage: `Configuration error: env var ${error.apiKeySecret} is required`,
      logFields: {
        api_key_secret: error.apiKeySecret,
        error_message: error.message,
        error_type: error.name,
      },
    };
  }

  if (error instanceof DeploymentConfigError) {
    // The message is operator-facing guidance built from validated env-var
    // names only — it never contains a secret value — so it is safe to post.
    return {
      commentMessage: error.message,
      logFields: {
        error_message: error.message,
        error_type: error.name,
      },
    };
  }

  return {
    commentMessage: "review failed",
    logFields: {
      error_message: errorMessageFrom(error),
    },
  };
}

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown review failure";
}

function requireString(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw new PullRequestHandlerDependencyError(`${field} is required`);
  }

  return value;
}

function requireNumber(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new PullRequestHandlerDependencyError(`${field} is required`);
  }

  return value;
}
