// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Rule: R-06 — only the bot's own active finding comments count for
// reconciliation. Also exercises R-05 (resolved or minimized comments are
// excluded so a reintroduced finding re-posts) and R-08 (a dismissed,
// still-active comment stays counted).
// Mirrors specs/bug-1965-rereview-finding-dedup/r-06-only-bot-comments-count.feature

import { describe, expect, it, vi } from "vitest";

import {
  fetchPostedFindings,
  minimizeFindingComments,
  type ReviewThreadsOctokit,
} from "../../src/github/posted-findings.js";

const REPO = { owner: "octo-org", repo: "sovri-target" };
const FP_A = "0a1b2c3d4e5f6a7b";
const FP_B = "ffeeddccbbaa9988";

function marker(fingerprint: string): string {
  return `**Finding**\n\nbody\n\n<!-- sovri-finding-id: ${fingerprint} -->`;
}

type Comment = {
  readonly id: string;
  readonly body: string;
  readonly isMinimized: boolean;
  readonly author: { readonly login: string } | null;
};

function stubOctokit(
  threads: readonly {
    readonly comments: readonly Comment[];
    readonly isResolved?: boolean;
  }[],
): ReviewThreadsOctokit {
  return {
    graphql: () =>
      Promise.resolve({
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: threads.map((thread) => ({
                comments: { nodes: thread.comments },
                isResolved: thread.isResolved ?? false,
              })),
            },
          },
        },
      }),
  };
}

describe("fetchPostedFindings", () => {
  it("counts a marker from a bot-authored, non-minimized comment", async () => {
    const octokit = stubOctokit([
      {
        comments: [
          {
            id: "RC_A",
            body: marker(FP_A),
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.has(FP_A)).toBe(true);
    expect(result.comments).toContainEqual({ nodeId: "RC_A", fingerprint: FP_A });
  });

  it("ignores a marker planted by another actor", async () => {
    const octokit = stubOctokit([
      {
        comments: [
          { id: "RC_evil", body: marker(FP_A), isMinimized: false, author: { login: "mallory" } },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.size).toBe(0);
  });

  it("ignores a bot comment that carries no finding marker", async () => {
    const octokit = stubOctokit([
      {
        comments: [
          {
            id: "RC_walkthrough",
            body: "<!-- sovri:walkthrough -->\nReview complete",
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.size).toBe(0);
    expect(result.comments).toHaveLength(0);
  });

  it("excludes a resolved bot marker so a reintroduced finding re-posts (R-05)", async () => {
    const octokit = stubOctokit([
      {
        isResolved: true,
        comments: [
          {
            id: "RC_resolved",
            body: marker(FP_A),
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
      {
        comments: [
          {
            id: "RC_active",
            body: marker(FP_B),
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.has(FP_A)).toBe(false);
    expect(result.fingerprints.has(FP_B)).toBe(true);
  });

  it("excludes a minimized bot marker so a reintroduced finding re-posts (R-05)", async () => {
    // Each finding is the root of its own review thread (fetched as first: 1).
    const octokit = stubOctokit([
      {
        comments: [
          {
            id: "RC_old",
            body: marker(FP_A),
            isMinimized: true,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
      {
        comments: [
          {
            id: "RC_new",
            body: marker(FP_B),
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.has(FP_A)).toBe(false);
    expect(result.fingerprints.has(FP_B)).toBe(true);
  });

  it("counts a dismissed but still-active (non-minimized) bot marker (R-08)", async () => {
    const octokit = stubOctokit([
      {
        comments: [
          {
            id: "RC_dismissed",
            body: marker(FP_A),
            isMinimized: false,
            author: { login: "sovri-bot[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "sovri-bot[bot]");

    expect(result.fingerprints.has(FP_A)).toBe(true);
  });

  it("resolves the bot identity from the supplied login override", async () => {
    const octokit = stubOctokit([
      {
        comments: [
          {
            id: "RC_self",
            body: marker(FP_A),
            isMinimized: false,
            author: { login: "my-sovri[bot]" },
          },
        ],
      },
    ]);

    const result = await fetchPostedFindings(octokit, REPO, 42, "my-sovri[bot]");

    expect(result.fingerprints.has(FP_A)).toBe(true);
  });
});

describe("minimizeFindingComments", () => {
  it("minimizes each node id as OUTDATED via GraphQL", async () => {
    const graphql = vi.fn().mockResolvedValue({});
    const octokit: ReviewThreadsOctokit = { graphql };

    await minimizeFindingComments(octokit, ["RC_gone_1", "RC_gone_2"]);

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("classifier: OUTDATED"), {
      subjectId: "RC_gone_1",
    });
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("minimizeComment"), {
      subjectId: "RC_gone_2",
    });
  });
});
