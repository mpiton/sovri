// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { extractFindingFingerprint, type PostedComment } from "@sovri/review-engine";
import { z } from "zod";

/**
 * The reconstructed prior state of the bot's findings on a pull request: the set
 * of fingerprints still actively posted (for deduplication) and the matching
 * comments (for resolution).
 */
export type PostedFindings = {
  readonly fingerprints: ReadonlySet<string>;
  readonly comments: readonly PostedComment[];
};

export type ReviewThreadsOctokit = {
  readonly graphql: (
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
};

type RepoRef = {
  readonly owner: string;
  readonly repo: string;
};

const REVIEW_THREADS_PAGE_SIZE = 100;

const ReviewThreadsResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          reviewThreads: z.object({
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              endCursor: z.string().nullable(),
            }),
            nodes: z.array(
              z.object({
                comments: z.object({
                  nodes: z.array(
                    z.object({
                      id: z.string(),
                      body: z.string(),
                      isMinimized: z.boolean(),
                      author: z.object({ login: z.string() }).nullable(),
                    }),
                  ),
                }),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const REVIEW_THREADS_QUERY = `
  query PostedFindings($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: ${REVIEW_THREADS_PAGE_SIZE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            comments(first: ${REVIEW_THREADS_PAGE_SIZE}) {
              nodes { id body isMinimized author { login } }
            }
          }
        }
      }
    }
  }
`;

/**
 * Reconstruct, from the GitHub API, the bot's still-active finding comments on a
 * pull request. Only comments authored by `botLogin` that are not minimized and
 * carry a `sovri-finding-id` marker are counted, so foreign-planted markers
 * cannot suppress a real finding (R-06), minimized comments let a reintroduced
 * finding re-post (R-05), and a dismissed-but-active comment stays counted
 * (R-08). The GraphQL payload is validated with Zod before use.
 */
export async function fetchPostedFindings(
  octokit: ReviewThreadsOctokit,
  repo: RepoRef,
  prNumber: number,
  botLogin: string,
): Promise<PostedFindings> {
  const comments = await collectPostedComments(octokit, repo, prNumber, botLogin, null);
  const fingerprints = new Set<string>();
  for (const comment of comments) {
    if (comment.fingerprint !== undefined) {
      fingerprints.add(comment.fingerprint);
    }
  }
  return { fingerprints, comments };
}

// Recursive pagination (mirrors the dispatcher's listReviewComments walk): each
// page depends on the previous page's cursor, so the calls are inherently
// sequential — there is no loop to parallelise.
async function collectPostedComments(
  octokit: ReviewThreadsOctokit,
  repo: RepoRef,
  prNumber: number,
  botLogin: string,
  cursor: string | null,
): Promise<PostedComment[]> {
  const raw = await octokit.graphql(REVIEW_THREADS_QUERY, {
    owner: repo.owner,
    repo: repo.repo,
    number: prNumber,
    cursor,
  });
  const threads = ReviewThreadsResponseSchema.parse(raw).repository?.pullRequest?.reviewThreads;
  if (threads === undefined) {
    return [];
  }

  const entries: PostedComment[] = [];
  for (const thread of threads.nodes) {
    for (const comment of thread.comments.nodes) {
      if (comment.author?.login !== botLogin || comment.isMinimized) {
        continue;
      }
      const fingerprint = extractFindingFingerprint(comment.body);
      if (fingerprint === undefined) {
        continue;
      }
      entries.push({ nodeId: comment.id, fingerprint });
    }
  }

  if (!threads.pageInfo.hasNextPage) {
    return entries;
  }
  const next = await collectPostedComments(
    octokit,
    repo,
    prNumber,
    botLogin,
    threads.pageInfo.endCursor,
  );
  return [...entries, ...next];
}
