// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DEFAULT_CONFIG, parseConfigContent, type SovriConfig } from "@sovri/config";
import { AnthropicProvider } from "@sovri/llm-providers";
import { createLogger } from "@sovri/observability";
import {
  buildInlineComments,
  reviewPullRequest,
  type Diff,
  type InlineCommentDraft,
  type Review,
  type ReviewPullRequestOptions,
} from "@sovri/review-engine";

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
  await context.octokit.rest.pulls.createReview({
    body: review.walkthrough_markdown,
    comments: buildInlineComments(review.findings, diff).map(toPullRequestReviewComment),
    commit_id: target.commitSha,
    event: "COMMENT",
    owner: repo.owner,
    pull_number: target.number,
    repo: repo.repo,
  });
}

function toPullRequestReviewComment(draft: InlineCommentDraft) {
  const base = {
    body: draft.body,
    line: draft.line,
    path: draft.path,
    side: draft.side,
  };

  if (draft.start_line === undefined || draft.start_side === undefined) {
    return base;
  }

  return {
    ...base,
    start_line: draft.start_line,
    start_side: draft.start_side,
  };
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
    provider: createProvider(config, env),
  };
}

function createProvider(config: SovriConfig, env: NodeJS.ProcessEnv): AnthropicProvider {
  if (config.llm.provider !== "anthropic") {
    throw new PullRequestReviewAdapterError("Unsupported LLM provider");
  }

  return new AnthropicProvider({
    env: buildAnthropicEnv(config, env),
    model: config.llm.model,
  });
}

function buildAnthropicEnv(config: SovriConfig, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const apiKey = env[config.llm.apiKeySecret]?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new PullRequestReviewAdapterError(`${config.llm.apiKeySecret} must be set`);
  }

  return {
    ANTHROPIC_API_KEY: apiKey,
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
