// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createLogger } from "@sovri/observability";
import type { InlineCommentDraft } from "@sovri/review-engine";

export const WALKTHROUGH_MARKER = "<!-- sovri:walkthrough -->";

const logger = createLogger("community-bot.comment-poster");
const FallbackIssueCommentNotice =
  "Sovri review could not be posted as a pull request review, so the walkthrough is posted as an issue comment.";

export type RepositoryRef = {
  readonly owner: string;
  readonly repo: string;
};

export type GitHubReviewResponse = {
  readonly body?: string | null;
  readonly id: number;
  readonly user?: {
    readonly login?: string;
  } | null;
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
  readonly actorLogin?: string;
  readonly logger?: CommentPosterLogger;
};

const LIST_PAGE_SIZE = 100;

export type PullRequestReviewCommentCreateParameters = {
  readonly body: string;
  readonly commit_id: string;
  readonly line: number;
  readonly owner: string;
  readonly path: string;
  readonly pull_number: number;
  readonly repo: string;
  readonly side: "RIGHT";
  readonly start_line?: number;
  readonly start_side?: "RIGHT";
};

export type CommentPosterOctokit = {
  readonly rest: {
    readonly issues: {
      readonly createComment: (
        parameters: IssueCommentCreateParameters,
      ) => Promise<{ readonly data: GitHubIssueCommentResponse }>;
      readonly deleteComment: (
        parameters: IssueCommentDeleteParameters,
      ) => Promise<{ readonly data: unknown }>;
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
      readonly createReviewComment: (
        parameters: PullRequestReviewCommentCreateParameters,
      ) => Promise<{ readonly data: { readonly id: number } }>;
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

type IssueCommentDeleteParameters = {
  readonly comment_id: number;
  readonly owner: string;
  readonly repo: string;
};

type IssueCommentListParameters = {
  readonly issue_number: number;
  readonly owner: string;
  readonly page?: number;
  readonly per_page?: number;
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
  readonly page?: number;
  readonly per_page?: number;
  readonly pull_number: number;
  readonly repo: string;
};

type PullRequestReviewUpdateParameters = {
  readonly body: string;
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
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
  const actorLogin = options.actorLogin;

  const existingReview = await findMarkedReview(octokit, repo, prNumber, actorLogin);
  try {
    if (existingReview !== undefined) {
      const response = await octokit.rest.pulls.updateReview({
        body,
        owner: repo.owner,
        pull_number: prNumber,
        repo: repo.repo,
        review_id: existingReview.id,
      });
      logReviewPosted(postLogger, repo, prNumber, response.data.id);
      await postInlineDrafts(octokit, repo, prNumber, review, postLogger);
      await cleanupStaleFallback(octokit, repo, prNumber, actorLogin, postLogger);
      return;
    }

    const request = buildPullRequestReviewRequest(repo, prNumber, review, body);
    const response = await octokit.rest.pulls.createReview(request);
    logReviewPosted(postLogger, repo, prNumber, response.data.id);
    await cleanupStaleFallback(octokit, repo, prNumber, actorLogin, postLogger);
  } catch (error) {
    await postFallbackComment({
      actorLogin,
      body,
      error,
      logger: postLogger,
      octokit,
      prNumber,
      repo,
    });
  }
}

async function postInlineDrafts(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  review: ReviewPostInput,
  postLogger: CommentPosterLogger,
): Promise<void> {
  const results = await Promise.allSettled(
    review.inlineComments.map((draft) =>
      octokit.rest.pulls.createReviewComment({
        ...toPullRequestReviewComment(draft),
        commit_id: review.commitSha,
        owner: repo.owner,
        pull_number: prNumber,
        repo: repo.repo,
      }),
    ),
  );

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result === undefined || result.status !== "rejected") {
      continue;
    }
    postLogger.info(
      {
        error_status: statusFrom(result.reason),
        inline_comment_index: index,
        pr_number: prNumber,
        repo: `${repo.owner}/${repo.repo}`,
      },
      "PR review inline comment post failed",
    );
  }
}

async function cleanupStaleFallback(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  actorLogin: string | undefined,
  postLogger: CommentPosterLogger,
): Promise<void> {
  let stale: GitHubIssueCommentResponse | undefined;
  try {
    stale = await findMarkedIssueComment(octokit, repo, prNumber, actorLogin);
  } catch (lookupError) {
    postLogger.info(
      {
        error_status: statusFrom(lookupError),
        pr_number: prNumber,
        repo: `${repo.owner}/${repo.repo}`,
      },
      "PR review stale fallback comment lookup failed",
    );
    return;
  }
  if (stale === undefined) {
    return;
  }
  try {
    await octokit.rest.issues.deleteComment({
      comment_id: stale.id,
      owner: repo.owner,
      repo: repo.repo,
    });
    postLogger.info(
      {
        fallback_comment_id: stale.id,
        pr_number: prNumber,
        repo: `${repo.owner}/${repo.repo}`,
      },
      "PR review stale fallback comment deleted",
    );
  } catch (deleteError) {
    postLogger.info(
      {
        error_status: statusFrom(deleteError),
        fallback_comment_id: stale.id,
        pr_number: prNumber,
        repo: `${repo.owner}/${repo.repo}`,
      },
      "PR review stale fallback comment delete failed",
    );
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
  actorLogin: string | undefined,
): Promise<GitHubReviewResponse | undefined> {
  return findMarkedReviewPage(octokit, repo, prNumber, actorLogin, 1);
}

async function findMarkedReviewPage(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  actorLogin: string | undefined,
  page: number,
): Promise<GitHubReviewResponse | undefined> {
  const response = await octokit.rest.pulls.listReviews({
    owner: repo.owner,
    page,
    per_page: LIST_PAGE_SIZE,
    pull_number: prNumber,
    repo: repo.repo,
  });

  const match = response.data.find((item) => hasWalkthroughMarker(item, actorLogin));
  if (match !== undefined) {
    return match;
  }
  if (response.data.length < LIST_PAGE_SIZE) {
    return undefined;
  }
  return findMarkedReviewPage(octokit, repo, prNumber, actorLogin, page + 1);
}

async function findMarkedIssueComment(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  actorLogin: string | undefined,
): Promise<GitHubIssueCommentResponse | undefined> {
  return findMarkedIssueCommentPage(octokit, repo, prNumber, actorLogin, 1);
}

async function findMarkedIssueCommentPage(
  octokit: CommentPosterOctokit,
  repo: RepositoryRef,
  prNumber: number,
  actorLogin: string | undefined,
  page: number,
): Promise<GitHubIssueCommentResponse | undefined> {
  const response = await octokit.rest.issues.listComments({
    issue_number: prNumber,
    owner: repo.owner,
    page,
    per_page: LIST_PAGE_SIZE,
    repo: repo.repo,
  });

  const match = response.data.find((item) => hasWalkthroughMarker(item, actorLogin));
  if (match !== undefined) {
    return match;
  }
  if (response.data.length < LIST_PAGE_SIZE) {
    return undefined;
  }
  return findMarkedIssueCommentPage(octokit, repo, prNumber, actorLogin, page + 1);
}

function hasWalkthroughMarker(
  item: {
    readonly body?: string | null;
    readonly user?: { readonly login?: string } | null;
  },
  actorLogin: string | undefined,
): boolean {
  if (typeof item.body !== "string" || !item.body.includes(WALKTHROUGH_MARKER)) {
    return false;
  }
  if (actorLogin === undefined) {
    return true;
  }
  return item.user?.login === actorLogin;
}

function markWalkthrough(markdown: string): string {
  if (markdown.startsWith(WALKTHROUGH_MARKER)) {
    return markdown;
  }

  return `${WALKTHROUGH_MARKER}\n${markdown}`;
}

async function postFallbackComment(values: {
  readonly actorLogin: string | undefined;
  readonly body: string;
  readonly error: unknown;
  readonly logger: CommentPosterLogger;
  readonly octokit: CommentPosterOctokit;
  readonly prNumber: number;
  readonly repo: RepositoryRef;
}): Promise<void> {
  const status = statusFrom(values.error);
  const fallbackBody = buildFallbackIssueCommentBody(values.body);
  try {
    const existing = await findMarkedIssueComment(
      values.octokit,
      values.repo,
      values.prNumber,
      values.actorLogin,
    );
    if (existing !== undefined) {
      const updated = await values.octokit.rest.issues.updateComment({
        body: fallbackBody,
        comment_id: existing.id,
        owner: values.repo.owner,
        repo: values.repo.repo,
      });
      logFallbackPosted(values.logger, values.repo, values.prNumber, updated.data.id);
      return;
    }

    const response = await values.octokit.rest.issues.createComment({
      body: fallbackBody,
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

function buildFallbackIssueCommentBody(body: string): string {
  if (body.startsWith(`${WALKTHROUGH_MARKER}\n`)) {
    return body.replace(
      `${WALKTHROUGH_MARKER}\n`,
      `${WALKTHROUGH_MARKER}\n${FallbackIssueCommentNotice}\n\n`,
    );
  }

  return `${FallbackIssueCommentNotice}\n\n${body}`;
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
