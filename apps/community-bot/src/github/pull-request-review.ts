// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DEFAULT_CONFIG, parseConfigContent, type SovriConfig } from "@sovri/config";
import { createProviderFromConfig } from "@sovri/llm-providers";
import { createLogger } from "@sovri/observability";
import {
  buildInlineComments,
  reviewPullRequest,
  type Diff,
  type Review,
  type ReviewPullRequestOptions,
} from "@sovri/review-engine";

import { postReview as postPullRequestReview } from "./comment-poster.js";
import type {
  PullRequestHandlerDependencies,
  PullRequestWebhookContext,
  ReviewCommentTarget,
  ReviewPostTarget,
} from "../handlers/pull-request.js";
import { fetchDiff as fetchPullRequestDiff } from "./diff-fetcher.js";

const logger = createLogger("community-bot.pull-request");

export function createPullRequestHandlerDependencies(
  context: PullRequestWebhookContext,
  env: NodeJS.ProcessEnv = process.env,
): PullRequestHandlerDependencies {
  return {
    buildReviewOptions: (config) => buildReviewOptions(config, env),
    fetchDiff: (target) =>
      fetchPullRequestDiff(context.octokit, splitRepoFullName(target.repoFullName), target.number),
    loadConfig: (target) => loadRepositoryConfig(context, target),
    logger,
    postErrorComment: (target, message) => postErrorComment(context, target, message),
    postReview: (target, review, diff) => postReview(context, target, review, diff),
    reviewPullRequest,
  };
}

async function loadRepositoryConfig(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
): Promise<SovriConfig> {
  const repo = splitRepoFullName(target.repoFullName);
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

    return parseConfigContent(response.data, ".sovri.yml");
  } catch (error) {
    if (isMissingRepositoryConfig(error)) {
      return DEFAULT_CONFIG;
    }

    throw error;
  }
}

async function postReview(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  review: Review,
  diff: Diff,
): Promise<void> {
  const repo = splitRepoFullName(target.repoFullName);
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
}

async function postErrorComment(
  context: PullRequestWebhookContext,
  target: ReviewCommentTarget,
  message: string,
): Promise<void> {
  const repo = splitRepoFullName(target.repoFullName);
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
    provider: createProviderFromConfig(config, env),
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
    throw new PullRequestReviewAdapterError("Repository full name is invalid");
  }

  return { owner, repo };
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
