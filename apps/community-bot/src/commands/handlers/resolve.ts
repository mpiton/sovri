// Copyright 2026 Sovri contributors
// SPDX-License-Identifier: Apache-2.0

import { z } from "@sovri/core";

import type { IssueCommentDismissCommandContext } from "../../handlers/issue-comment.js";

const REVIEW_COMMENT_PAGE_SIZE = 100;
const REACTION_PAGE_SIZE = 100;
const RESOLVE_FAILURE_BODY = "Resolve command could not be completed. Please retry later.";
const UNAUTHORIZED_RESOLVE_BODY = "Only the pull request author can resolve findings.";
const FindingMarkerPattern = /<!--\s*sovri-finding-id:\s*([A-Za-z0-9-]{1,64})\s*-->/u;
const AlreadyExistsMessagePattern = /already(?:_| )exists/iu;
const GitHubErrorStatusSchema = z.object({ status: z.number().int() }).passthrough();
const PullRequestAuthorSchema = z
  .object({
    user: z
      .object({
        login: z.string().min(1),
      })
      .nullable(),
  })
  .passthrough();
const ResolveReviewThreadsResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          reviewThreads: z.object({
            pageInfo: z.object({
              endCursor: z.string().nullable(),
              hasNextPage: z.boolean(),
            }),
            nodes: z.array(
              z.object({
                comments: z.object({
                  nodes: z.array(
                    z.object({
                      author: z.object({ login: z.string() }).nullable(),
                      body: z.string(),
                      id: z.string(),
                    }),
                  ),
                }),
                id: z.string(),
                isResolved: z.boolean(),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const RESOLVE_REVIEW_THREADS_PAGE_SIZE = 100;
const RESOLVE_REVIEW_THREADS_QUERY = `
  query ResolveReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: ${RESOLVE_REVIEW_THREADS_PAGE_SIZE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes { id body author { login } }
            }
          }
        }
      }
    }
  }
`;
const RESOLVE_REVIEW_THREAD_MUTATION = `
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { isResolved }
    }
  }
`;
const MINIMIZE_RESOLVED_COMMENT_MUTATION = `
  mutation MinimizeResolvedComment($subjectId: ID!) {
    minimizeComment(input: { subjectId: $subjectId, classifier: RESOLVED }) {
      minimizedComment { isMinimized }
    }
  }
`;

export type ResolveCommandOctokit = {
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly rest: {
    readonly issues: {
      readonly createComment: (
        parameters: IssueCommentCreateParameters,
      ) => Promise<{ readonly data: unknown }>;
    };
    readonly pulls: {
      readonly get: (parameters: PullRequestGetParameters) => Promise<{ readonly data: unknown }>;
      readonly listReviewComments: (
        parameters: PullRequestReviewCommentListParameters,
      ) => Promise<{ readonly data: readonly PullRequestReviewComment[] }>;
    };
    readonly reactions: {
      readonly createForIssueComment: (
        parameters: IssueCommentReactionParameters,
      ) => Promise<{ readonly data: unknown }>;
      readonly listForIssueComment: (
        parameters: IssueCommentReactionListParameters,
      ) => Promise<{ readonly data: readonly IssueCommentReaction[] }>;
    };
  };
};

export type ResolveCommandContext = {
  readonly octokit: ResolveCommandOctokit;
};

export type ResolveCommandLogger = {
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

type IssueCommentCreateParameters = {
  readonly body: string;
  readonly issue_number: number;
  readonly owner: string;
  readonly repo: string;
};

type PullRequestGetParameters = {
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
};

type PullRequestReviewCommentListParameters = PullRequestGetParameters & {
  readonly page?: number;
  readonly per_page?: number;
};

type IssueCommentReactionParameters = {
  readonly comment_id: number;
  readonly content: "+1";
  readonly owner: string;
  readonly repo: string;
};

type IssueCommentReactionListParameters = {
  readonly comment_id: number;
  readonly owner: string;
  readonly page?: number;
  readonly per_page?: number;
  readonly repo: string;
};

type IssueCommentReaction = {
  readonly content?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type PullRequestReviewComment = {
  readonly body?: string | null;
  readonly id: number;
  readonly node_id?: string;
  readonly user?: {
    readonly login?: string;
  } | null;
};

type RepoRef = {
  readonly owner: string;
  readonly repo: string;
};

type ResolveReviewThread = {
  readonly id: string;
  readonly isResolved: boolean;
};

type ResolveReviewThreadNode = {
  readonly comments: {
    readonly nodes: readonly {
      readonly author: {
        readonly login: string;
      } | null;
      readonly body: string;
      readonly id: string;
    }[];
  };
  readonly id: string;
  readonly isResolved: boolean;
};

export async function handleResolveCommand(
  context: ResolveCommandContext,
  command: IssueCommentDismissCommandContext,
  botLogin: string,
  dispatchLogger: ResolveCommandLogger,
): Promise<void> {
  const logContext = buildResolveLogContext(command);
  dispatchLogger.info(logContext, "Resolve command started");
  const repo = splitRepoFullName(command.repoFullName);
  try {
    const pullRequestAuthorLogin = await resolvePullRequestAuthorLogin(context, command, repo);

    if (command.commentAuthorLogin !== pullRequestAuthorLogin) {
      await context.octokit.rest.issues.createComment({
        body: UNAUTHORIZED_RESOLVE_BODY,
        issue_number: command.pullRequestNumber,
        owner: repo.owner,
        repo: repo.repo,
      });
      return;
    }

    const reviewComments = await listReviewCommentsOnAllPages(context, command, repo);
    const botReviewComments = reviewComments.filter((comment) => comment.user?.login === botLogin);
    const findingComment = botReviewComments.find((comment) =>
      hasFindingMarker(comment, command.findingId),
    );

    if (findingComment === undefined) {
      await context.octokit.rest.issues.createComment({
        body: `Finding ${command.findingId} was not found, so nothing changed.`,
        issue_number: command.pullRequestNumber,
        owner: repo.owner,
        repo: repo.repo,
      });
      return;
    }

    const thread = await findResolveReviewThread(
      context,
      command,
      repo,
      botLogin,
      findingComment.node_id,
      null,
      undefined,
    );
    if (thread === undefined) {
      await minimizeResolvedComment(context, repo, findingComment);
    } else if (!thread.isResolved) {
      await resolveReviewThread(context, thread.id);
    }

    await createAcceptedIssueReaction(context, repo, command.commentId, botLogin);
    dispatchLogger.info({ ...logContext, result: "success" }, "Resolve command completed");
  } catch (error) {
    dispatchLogger.error(buildResolveErrorLogContext(logContext, error), "Resolve command failed");
    await context.octokit.rest.issues.createComment({
      body: RESOLVE_FAILURE_BODY,
      issue_number: command.pullRequestNumber,
      owner: repo.owner,
      repo: repo.repo,
    });
  }
}

function buildResolveLogContext(
  command: IssueCommentDismissCommandContext,
): Readonly<Record<string, unknown>> {
  return {
    delivery_id: command.correlationId,
    pr_number: command.pullRequestNumber,
    repo: command.repoFullName,
  };
}

function buildResolveErrorLogContext(
  logContext: Readonly<Record<string, unknown>>,
  error: unknown,
): Readonly<Record<string, unknown>> {
  const status = githubStatusFrom(error);
  return status === undefined ? logContext : { ...logContext, github_status: status };
}

function githubStatusFrom(error: unknown): number | undefined {
  const result = GitHubErrorStatusSchema.safeParse(error);
  return result.success ? result.data.status : undefined;
}

async function resolvePullRequestAuthorLogin(
  context: ResolveCommandContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
): Promise<string> {
  const response = await context.octokit.rest.pulls.get({
    owner: repo.owner,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  const pullRequest = PullRequestAuthorSchema.parse(response.data);
  if (pullRequest.user === null) {
    throw new ResolveCommandAdapterError("Pull request author is missing");
  }

  return pullRequest.user.login;
}

async function listReviewCommentsOnAllPages(
  context: ResolveCommandContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
): Promise<PullRequestReviewComment[]> {
  return listReviewCommentsPage(context, command, repo, 1);
}

async function listReviewCommentsPage(
  context: ResolveCommandContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  page: number,
): Promise<PullRequestReviewComment[]> {
  const comments = await context.octokit.rest.pulls.listReviewComments({
    owner: repo.owner,
    page,
    per_page: REVIEW_COMMENT_PAGE_SIZE,
    pull_number: command.pullRequestNumber,
    repo: repo.repo,
  });
  if (comments.data.length < REVIEW_COMMENT_PAGE_SIZE) {
    return [...comments.data];
  }

  return [...comments.data, ...(await listReviewCommentsPage(context, command, repo, page + 1))];
}

function hasFindingMarker(comment: PullRequestReviewComment, findingId: string): boolean {
  return extractFindingId(comment.body) === findingId;
}

async function findResolveReviewThread(
  context: ResolveCommandContext,
  command: IssueCommentDismissCommandContext,
  repo: RepoRef,
  botLogin: string,
  targetRootCommentNodeId: string | undefined,
  cursor: string | null,
  fallbackThread: ResolveReviewThread | undefined,
): Promise<ResolveReviewThread | undefined> {
  const raw = await context.octokit.graphql(RESOLVE_REVIEW_THREADS_QUERY, {
    cursor,
    number: command.pullRequestNumber,
    owner: repo.owner,
    repo: repo.repo,
  });
  const threads =
    ResolveReviewThreadsResponseSchema.parse(raw).repository?.pullRequest?.reviewThreads;
  if (threads === undefined) {
    return undefined;
  }

  const pageMatch = findResolveReviewThreadOnPage(
    threads.nodes,
    botLogin,
    command.findingId,
    targetRootCommentNodeId,
  );
  if (pageMatch.exact !== undefined) {
    return pageMatch.exact;
  }

  const nextFallbackThread = fallbackThread ?? pageMatch.fallback;

  if (!threads.pageInfo.hasNextPage) {
    return targetRootCommentNodeId === undefined ? nextFallbackThread : undefined;
  }

  return findResolveReviewThread(
    context,
    command,
    repo,
    botLogin,
    targetRootCommentNodeId,
    threads.pageInfo.endCursor,
    nextFallbackThread,
  );
}

function findResolveReviewThreadOnPage(
  threads: readonly ResolveReviewThreadNode[],
  botLogin: string,
  findingId: string,
  targetRootCommentNodeId: string | undefined,
): { readonly exact?: ResolveReviewThread; readonly fallback?: ResolveReviewThread } {
  let fallback: ResolveReviewThread | undefined;
  for (const thread of threads) {
    const rootComment = thread.comments.nodes[0];
    if (
      rootComment?.author?.login !== botLogin ||
      extractFindingId(rootComment.body) !== findingId
    ) {
      continue;
    }

    const candidate = { id: thread.id, isResolved: thread.isResolved };
    if (
      rootComment.id === targetRootCommentNodeId ||
      (targetRootCommentNodeId === undefined && !thread.isResolved)
    ) {
      return { exact: candidate };
    }
    fallback ??= candidate;
  }

  return fallback === undefined ? {} : { fallback };
}

async function resolveReviewThread(
  context: ResolveCommandContext,
  threadId: string,
): Promise<void> {
  try {
    await context.octokit.graphql(RESOLVE_REVIEW_THREAD_MUTATION, { threadId });
  } catch (error) {
    if (isGithubAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

async function minimizeResolvedComment(
  context: ResolveCommandContext,
  repo: RepoRef,
  comment: PullRequestReviewComment,
): Promise<void> {
  if (comment.node_id === undefined) {
    throw new ResolveCommandAdapterError("Review comment node id is missing");
  }

  await context.octokit.graphql(MINIMIZE_RESOLVED_COMMENT_MUTATION, {
    owner: repo.owner,
    repo: repo.repo,
    subjectId: comment.node_id,
  });
}

async function createAcceptedIssueReaction(
  context: ResolveCommandContext,
  repo: RepoRef,
  commentId: number,
  botLogin: string,
): Promise<void> {
  if (await hasAcceptedIssueReaction(context, repo, commentId, botLogin)) {
    return;
  }

  try {
    await context.octokit.rest.reactions.createForIssueComment({
      comment_id: commentId,
      content: "+1",
      owner: repo.owner,
      repo: repo.repo,
    });
  } catch (error) {
    if (isGithubAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

async function hasAcceptedIssueReaction(
  context: ResolveCommandContext,
  repo: RepoRef,
  commentId: number,
  botLogin: string,
): Promise<boolean> {
  return hasAcceptedIssueReactionPage(context, repo, commentId, botLogin, 1);
}

async function hasAcceptedIssueReactionPage(
  context: ResolveCommandContext,
  repo: RepoRef,
  commentId: number,
  botLogin: string,
  page: number,
): Promise<boolean> {
  const reactions = await context.octokit.rest.reactions.listForIssueComment({
    comment_id: commentId,
    owner: repo.owner,
    page,
    per_page: REACTION_PAGE_SIZE,
    repo: repo.repo,
  });
  const accepted = reactions.data.some(
    (reaction) => reaction.content === "+1" && reaction.user?.login === botLogin,
  );
  if (accepted) {
    return true;
  }
  if (reactions.data.length < REACTION_PAGE_SIZE) {
    return false;
  }

  return hasAcceptedIssueReactionPage(context, repo, commentId, botLogin, page + 1);
}

function isGithubAlreadyExistsError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const status = readNumberProperty(error, "status");
  if (status !== 409 && status !== 422) {
    return false;
  }

  const message =
    error instanceof Error ? error.message : (readStringProperty(error, "message") ?? "");
  return AlreadyExistsMessagePattern.test(message);
}

function extractFindingId(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return FindingMarkerPattern.exec(value)?.[1];
}

function splitRepoFullName(repoFullName: string): RepoRef {
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
    throw new ResolveCommandAdapterError("Repository full name is invalid");
  }

  return { owner, repo };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumberProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): number | undefined {
  const value = record[property];
  return typeof value === "number" ? value : undefined;
}

function readStringProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}

class ResolveCommandAdapterError extends Error {
  public override readonly name = "ResolveCommandAdapterError";
}
