// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { parseConfigContent, type SovriConfig } from "@sovri/config";
import { createProviderFromConfig } from "@sovri/llm-providers";
import { createLogger } from "@sovri/observability";
import {
  buildInlineComments,
  reviewPullRequest,
  type Diff,
  type ReviewPullRequestOptions,
} from "@sovri/review-engine";

import { readBotLogin, splitRepoFullName } from "../commands/shared-utilities.js";
import { postReview as postPullRequestReview } from "./comment-poster.js";
import {
  postCheckRuns,
  type ReviewWithOptionalCheckRunDescriptors,
} from "./pull-request-checks.js";
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
