// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createLogger } from "@sovri/observability";
import type { InlineCommentDraft } from "@sovri/review-engine";

export const WALKTHROUGH_MARKER = "<!-- sovri:walkthrough -->";

const logger = createLogger("community-bot.comment-poster");

export type RepositoryRef = {
  readonly owner: string;
  readonly repo: string;
};

export type GitHubReviewResponse = {
  readonly body?: string | null;
  readonly id: number;
};

export type GitHubIssueCommentResponse = GitHubReviewResponse;

export type PullRequestReviewCommentRequest = {
  readonly body: string;
  readonly line: number;
  readonly path: string;
  readonly side: "RIGHT";
  readonly start_line?: number;
  readonly start_side?: "RIGHT";
};

export type PullRequestReviewRequest = {
  readonly body: string;
  readonly comments: PullRequestReviewCommentRequest[];
  readonly commit_id: string;
  readonly event: "COMMENT";
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
};

export type ReviewPostInput = {
  readonly commitSha: string;
  readonly inlineComments: readonly InlineCommentDraft[];
  readonly walkthroughMarkdown: string;
};

export type CommentPosterLogger = {
  readonly info: (bindings: Readonly<Record<string, unknown>>, message: string) => void;
};

export type CommentPosterOptions = {
  readonly logger?: CommentPosterLogger;
};

export type CommentPosterOctokit = {
  readonly rest: {
    readonly issues: {
      readonly createComment: (
        parameters: IssueCommentCreateParameters,
      ) => Promise<{ readonly data: GitHubIssueCommentResponse }>;
      readonly listComments: (
        parameters: IssueCommentListParameters,
      ) => Promise<{ readonly data: readonly GitHubIssueCommentResponse[] }>;
      readonly updateComment: (
        parameters: IssueCommentUpdateParameters,
      ) => Promise<{ readonly data: GitHubIssueCommentResponse }>;
    };
    readonly pulls: {
      readonly createReview: (
        parameters: PullRequestReviewRequest,
      ) => Promise<{ readonly data: GitHubReviewResponse }>;
      readonly listReviews: (
        parameters: PullRequestReviewListParameters,
      ) => Promise<{ readonly data: readonly GitHubReviewResponse[] }>;
      readonly updateReview: (
        parameters: PullRequestReviewUpdateParameters,
      ) => Promise<{ readonly data: GitHubReviewResponse }>;
    };
  };
};

type IssueCommentCreateParameters = {
  readonly body: string;
  readonly issue_number: number;
  readonly owner: string;
  readonly repo: string;
};

type IssueCommentListParameters = {
  readonly issue_number: number;
  readonly owner: string;
  readonly repo: string;
};

type IssueCommentUpdateParameters = {
  readonly body: string;
  readonly comment_id: number;
  readonly owner: string;
  readonly repo: string;
};

type PullRequestReviewListParameters = {
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
};

type PullRequestReviewUpdateParameters = PullRequestReviewListParameters & {
  readonly body: string;
  readonly review_id: number;
};

type ReviewPostErrorOptions = {
  readonly cause?: unknown;
  readonly fallbackStatus?: number | undefined;
  readonly status?: number | undefined;
};

export class ReviewPostError extends Error {
  public override readonly name = "ReviewPostError";
  public readonly fallbackStatus?: number;
  public readonly status?: number;

  public constructor(message: string, options: ReviewPostErrorOptions = {}) {
    super(message, { cause: options.cause });
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.fallbackStatus !== undefined) {
      this.fallbackStatus = options.fallbackStatus;
    }
  }
}

export async function postReview(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  review: ReviewPostInput,
  options: CommentPosterOptions = {},
): Promise<void> {
  const postLogger = options.logger ?? logger;
  const body = markWalkthrough(review.walkthroughMarkdown);
  const existingReview = await findMarkedReview(octokit, repo, prNumber);
  if (existingReview !== undefined) {
    const response = await octokit.rest.pulls.updateReview({
      body,
      owner: repo.owner,
      pull_number: prNumber,
      repo: repo.repo,
      review_id: existingReview.id,
    });
    logReviewPosted(postLogger, repo, prNumber, response.data.id);
    return;
  }

  const existingComment = await findMarkedIssueComment(octokit, repo, prNumber);
  if (existingComment !== undefined) {
    const response = await octokit.rest.issues.updateComment({
      body,
      comment_id: existingComment.id,
      owner: repo.owner,
      repo: repo.repo,
    });
    logFallbackPosted(postLogger, repo, prNumber, response.data.id);
    return;
  }

  try {
    const request = buildPullRequestReviewRequest(repo, prNumber, review, body);
    const response = await octokit.rest.pulls.createReview(request);
    logReviewPosted(postLogger, repo, prNumber, response.data.id);
  } catch (error) {
    await postFallbackComment({
      body,
      error,
      logger: postLogger,
      octokit,
      prNumber,
      repo,
    });
  }
}

export function validatePullRequestReviewRequest(value: unknown): PullRequestReviewRequest {
  if (!isRecord(value)) {
    throw new Error("Pull request review request must be an object");
  }

  const event = value["event"];
  if (event !== "COMMENT") {
    throw new Error("Pull request review event must be COMMENT");
  }

  const body = readString(value, "body");
  const commitId = readString(value, "commit_id");
  const owner = readString(value, "owner");
  const repo = readString(value, "repo");
  const pullNumber = readPositiveInteger(value, "pull_number");
  const commentsValue = value["comments"];
  if (!Array.isArray(commentsValue)) {
    throw new Error("Pull request review comments must be an array");
  }

  return {
    body,
    comments: commentsValue.map(validatePullRequestReviewComment),
    commit_id: commitId,
    event,
    owner,
    pull_number: pullNumber,
    repo,
  };
}

function buildPullRequestReviewRequest(
  repo: RepositoryRef,
  prNumber: number,
  review: ReviewPostInput,
  body: string,
): PullRequestReviewRequest {
  return validatePullRequestReviewRequest({
    body,
    comments: review.inlineComments.map(toPullRequestReviewComment),
    commit_id: review.commitSha,
    event: "COMMENT",
    owner: repo.owner,
    pull_number: prNumber,
    repo: repo.repo,
  });
}

function toPullRequestReviewComment(draft: InlineCommentDraft): PullRequestReviewCommentRequest {
  const base = {
    body: draft.body,
    line: draft.line,
    path: draft.path,
    side: draft.side,
  } satisfies PullRequestReviewCommentRequest;

  if (draft.start_line === undefined || draft.start_side === undefined) {
    return base;
  }

  return {
    ...base,
    start_line: draft.start_line,
    start_side: draft.start_side,
  };
}

function validatePullRequestReviewComment(value: unknown): PullRequestReviewCommentRequest {
  if (!isRecord(value)) {
    throw new Error("Pull request review comment must be an object");
  }

  const side = value["side"];
  if (side !== "RIGHT") {
    throw new Error("Pull request review comment side must be RIGHT");
  }

  const startLine = value["start_line"];
  const startSide = value["start_side"];
  const hasStartLine = startLine !== undefined;
  const hasStartSide = startSide !== undefined;
  if (hasStartLine !== hasStartSide) {
    throw new Error("Pull request review start_line and start_side must be paired");
  }

  const base = {
    body: readString(value, "body"),
    line: readPositiveInteger(value, "line"),
    path: readString(value, "path"),
    side: "RIGHT" as const,
  };

  if (!hasStartLine && !hasStartSide) {
    return base;
  }

  if (startSide !== "RIGHT") {
    throw new Error("Pull request review comment start_side must be RIGHT");
  }

  if (typeof startLine !== "number" || !Number.isInteger(startLine) || startLine <= 0) {
    throw new Error("Pull request review comment start_line must be a positive integer");
  }

  return {
    ...base,
    start_line: startLine,
    start_side: "RIGHT" as const,
  };
}

async function findMarkedReview(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
): Promise<GitHubReviewResponse | undefined> {
  const response = await octokit.rest.pulls.listReviews({
    owner: repo.owner,
    pull_number: prNumber,
    repo: repo.repo,
  });

  return response.data.find(hasWalkthroughMarker);
}

async function findMarkedIssueComment(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
): Promise<GitHubIssueCommentResponse | undefined> {
  const response = await octokit.rest.issues.listComments({
    issue_number: prNumber,
    owner: repo.owner,
    repo: repo.repo,
  });

  return response.data.find(hasWalkthroughMarker);
}

function hasWalkthroughMarker(item: { readonly body?: string | null }): boolean {
  return typeof item.body === "string" && item.body.includes(WALKTHROUGH_MARKER);
}

function markWalkthrough(markdown: string): string {
  if (markdown.startsWith(WALKTHROUGH_MARKER)) {
    return markdown;
  }

  return `${WALKTHROUGH_MARKER}\n${markdown}`;
}

async function postFallbackComment(values: {
  readonly body: string;
  readonly error: unknown;
  readonly logger: CommentPosterLogger;
  readonly octokit: CommentPosterOctokit;
  readonly prNumber: number;
  readonly repo: RepositoryRef;
}): Promise<void> {
  const status = statusFrom(values.error);
  try {
    const response = await values.octokit.rest.issues.createComment({
      body: values.body,
      issue_number: values.prNumber,
      owner: values.repo.owner,
      repo: values.repo.repo,
    });
    logFallbackPosted(values.logger, values.repo, values.prNumber, response.data.id);
  } catch (fallbackError) {
    throw new ReviewPostError("Pull request review posting failed", {
      cause: fallbackError,
      fallbackStatus: statusFrom(fallbackError),
      status,
    });
  }
}

function logReviewPosted(
  log: CommentPosterLogger,
  repo: RepositoryRef,
  prNumber: number,
  reviewId: number,
): void {
  log.info(
    {
      pr_number: prNumber,
      repo: `${repo.owner}/${repo.repo}`,
      review_id: reviewId,
    },
    "PR review posted",
  );
}

function logFallbackPosted(
  log: CommentPosterLogger,
  repo: RepositoryRef,
  prNumber: number,
  commentId: number,
): void {
  log.info(
    {
      fallback_comment_id: commentId,
      pr_number: prNumber,
      repo: `${repo.owner}/${repo.repo}`,
    },
    "PR review fallback comment posted",
  );
}

function statusFrom(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }

  const status = Reflect.get(error, "status");
  if (typeof status === "number") {
    return status;
  }

  const response = Reflect.get(error, "response");
  if (response !== null && typeof response === "object") {
    const responseStatus = Reflect.get(response, "status");
    if (typeof responseStatus === "number") {
      return responseStatus;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

function readString(value: Readonly<Record<string, unknown>>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`Pull request review ${field} must be a non-empty string`);
  }

  return fieldValue;
}

function readPositiveInteger(value: Readonly<Record<string, unknown>>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue !== "number" || !Number.isInteger(fieldValue) || fieldValue <= 0) {
    throw new Error(`Pull request review ${field} must be a positive integer`);
  }

  return fieldValue;
}
