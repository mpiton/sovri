// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { parseConfigContent, type SovriConfig } from "@sovri/config";
import { createProviderFromConfig } from "@sovri/llm-providers";
import { createLogger } from "@sovri/observability";
import {
  buildInlineComments,
  reviewPullRequest,
  type CheckRunDescriptor,
  type Diff,
  type Review,
  type ReviewPullRequestOptions,
} from "@sovri/review-engine";

import { readBotLogin, splitRepoFullName } from "../commands/shared-utilities.js";
import { postReview as postPullRequestReview } from "./comment-poster.js";
import { getHttpStatus } from "./diff-fetcher-contract.js";
import { fetchPostedFindings, minimizeFindingComments } from "./posted-findings.js";
import type {
  PullRequestHandlerDependencies,
  PullRequestWebhookContext,
  ReviewCommentTarget,
  ReviewPostTarget,
} from "../handlers/pull-request.js";
import { fetchDiff as fetchPullRequestDiff } from "./diff-fetcher.js";
import { buildDeploymentDefaultConfig } from "../runtime-env.js";

const logger = createLogger("community-bot.pull-request");
export const ReviewTimeoutMs = 300_000;

type ReviewWithOptionalCheckRunDescriptors = Review & {
  readonly check_run_descriptors?: readonly CheckRunDescriptor[];
};

export function createPullRequestHandlerDependencies(
  context: PullRequestWebhookContext,
  env: NodeJS.ProcessEnv = process.env,
): PullRequestHandlerDependencies {
  const botLogin = readBotLogin(env);
  return {
    buildReviewOptions: (config) => buildReviewOptions(config, env),
    fetchDiff: (target) =>
      fetchPullRequestDiff(
        context.octokit,
        splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError),
        target.number,
      ),
    fetchPostedFindings: (target) =>
      fetchPostedFindings(
        context.octokit,
        splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError),
        target.number,
        botLogin,
      ),
    loadConfig: (target) => loadRepositoryConfig(context, target, env),
    logger,
    minimizeComments: (_target, nodeIds) => minimizeFindingComments(context.octokit, nodeIds),
    postErrorComment: (target, message) => postErrorComment(context, target, message),
    postReview: (target, review, diff, checkSourceReview) =>
      postReview(context, target, review, diff, checkSourceReview),
    reviewPullRequest,
  };
}

async function loadRepositoryConfig(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  env: NodeJS.ProcessEnv,
): Promise<SovriConfig> {
  const repo = splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError);
  try {
    const response = await context.octokit.rest.repos.getContent({
      mediaType: {
        format: "raw",
      },
      owner: repo.owner,
      path: ".sovri.yml",
      ref: target.baseSha,
      repo: repo.repo,
    });

    if (typeof response.data !== "string") {
      throw new PullRequestReviewAdapterError("Repository config content is invalid");
    }

    // `.sovri.yml` is optional: an absent (404) or empty file resolves to the
    // deployment default provider (issue #1959), never a hard-coded provider.
    // The fallback is lazy so a repository that ships its own config is never
    // shadowed and a deployment-config error never fires for those repos.
    return parseConfigContent(response.data, ".sovri.yml", () =>
      buildDeploymentDefaultConfig(env, logger),
    );
  } catch (error) {
    if (isMissingRepositoryConfig(error)) {
      return buildDeploymentDefaultConfig(env, logger);
    }

    throw error;
  }
}

async function postReview(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  review: ReviewWithOptionalCheckRunDescriptors,
  diff: Diff,
  checkSourceReview: ReviewWithOptionalCheckRunDescriptors = review,
): Promise<void> {
  const repo = splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError);
  await postPullRequestReview(
    context.octokit,
    repo,
    target.number,
    {
      commitSha: target.commitSha,
      inlineComments: buildInlineComments(review.findings, diff),
      walkthroughMarkdown: review.walkthrough_markdown,
    },
    {
      logger,
    },
  );
  await postCheckRuns(context, target, checkSourceReview);
}

async function postCheckRuns(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  review: ReviewWithOptionalCheckRunDescriptors,
): Promise<void> {
  const checks = context.octokit.rest.checks;
  if (checks === undefined) {
    return;
  }

  const descriptors = requireCheckRunDescriptors(review);
  const repo = splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError);

  await Promise.all(
    descriptors.map((descriptor) => postCheckRun(context, target, repo, descriptor)),
  );
}

function requireCheckRunDescriptors(
  review: ReviewWithOptionalCheckRunDescriptors,
): readonly CheckRunDescriptor[] {
  const descriptors = review.check_run_descriptors;
  if (descriptors === undefined) {
    throw new PullRequestReviewAdapterError("Review check descriptors are unavailable");
  }

  return descriptors;
}

async function postCheckRun(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  repo: { readonly owner: string; readonly repo: string },
  descriptor: CheckRunDescriptor,
): Promise<void> {
  const checks = context.octokit.rest.checks;
  if (checks === undefined) {
    return;
  }

  try {
    await checks.create({
      conclusion: descriptor.conclusion,
      head_sha: target.commitSha,
      name: descriptor.name,
      output: {
        summary: descriptor.summary,
        title: descriptor.title,
      },
      owner: repo.owner,
      repo: repo.repo,
      status: descriptor.status,
    });
  } catch (error) {
    logger.error(
      {
        check_name: descriptor.name,
        delivery_id: context.id,
        error_type: errorTypeFrom(error),
        pr_number: target.number,
        repo: target.repoFullName,
        status: getHttpStatus(error),
      },
      "Sovri check run posting failed",
    );
  }
}

async function postErrorComment(
  context: PullRequestWebhookContext,
  target: ReviewCommentTarget,
  message: string,
): Promise<void> {
  const repo = splitRepoFullName(target.repoFullName, createPullRequestReviewAdapterError);
  await context.octokit.rest.issues.createComment({
    body: message,
    issue_number: target.number,
    owner: repo.owner,
    repo: repo.repo,
  });
}

function buildReviewOptions(config: SovriConfig, env: NodeJS.ProcessEnv): ReviewPullRequestOptions {
  return {
    logger,
    provider: createProviderFromConfig(config, env, { timeoutMs: ReviewTimeoutMs }),
  };
}

function errorTypeFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "NonErrorThrow";
}

function isMissingRepositoryConfig(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  return Reflect.get(error, "status") === 404;
}

class PullRequestReviewAdapterError extends Error {
  public override readonly name = "PullRequestReviewAdapterError";
}

function createPullRequestReviewAdapterError(message: string): PullRequestReviewAdapterError {
  return new PullRequestReviewAdapterError(message);
}
