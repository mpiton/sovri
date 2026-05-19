// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { DiffSchema, z, type Diff } from "@sovri/core";
import { parseUnifiedDiff } from "@sovri/review-engine";

import {
  DiffFetchError,
  GitHubPageSize,
  MaxPullRequestFiles,
  type DiffFetcherOctokit,
  type GitHubRepositoryRef,
} from "./diff-fetcher-contract.js";

const ZeroSha = "0000000000000000000000000000000000000000";

const GitHubPullRequestFileSchema = z
  .object({
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    filename: z.string(),
    patch: z.string().nullable().optional(),
    previous_filename: z.string().optional(),
    sha: z.string(),
    status: z.string(),
  })
  .passthrough();
const GitHubPullRequestFilesPageSchema = z.array(GitHubPullRequestFileSchema);
type GitHubPullRequestFile = z.infer<typeof GitHubPullRequestFileSchema>;

export async function fetchDiffFromFiles(
  octokit: DiffFetcherOctokit,
  repo: GitHubRepositoryRef,
  prNumber: number,
  signal: AbortSignal,
): Promise<Diff> {
  return fetchDiffFilesPage(octokit, repo, prNumber, signal, 1, []);
}

async function fetchDiffFilesPage(
  octokit: DiffFetcherOctokit,
  repo: GitHubRepositoryRef,
  prNumber: number,
  signal: AbortSignal,
  page: number,
  previousFiles: readonly GitHubPullRequestFile[],
): Promise<Diff> {
  const response = await octokit.rest.pulls.listFiles({
    owner: repo.owner,
    page,
    per_page: GitHubPageSize,
    pull_number: prNumber,
    repo: repo.repo,
    request: { signal },
  });
  const pageFiles = parseFilesPage(response.data);
  const files = [...previousFiles, ...pageFiles];

  if (files.length >= MaxPullRequestFiles) {
    throw new DiffFetchError(
      `Pull request diff reaches GitHub's ${String(MaxPullRequestFiles)}-file listing cap; results may be truncated`,
    );
  }
  if (pageFiles.length < GitHubPageSize) {
    return parseConstructedDiff(files);
  }
  return fetchDiffFilesPage(octokit, repo, prNumber, signal, page + 1, files);
}

function parseFilesPage(data: unknown): GitHubPullRequestFile[] {
  const result = GitHubPullRequestFilesPageSchema.safeParse(data);
  if (!result.success) {
    throw new DiffFetchError("GitHub pull request files response is invalid", {
      cause: result.error,
    });
  }
  return result.data;
}

function parseConstructedDiff(files: readonly GitHubPullRequestFile[]): Diff {
  const unifiedDiff = files.map(buildFileDiff).join("\n");
  try {
    const diff = parseUnifiedDiff(unifiedDiff);
    const result = DiffSchema.safeParse(diff);
    if (!result.success) {
      throw new DiffFetchError("GitHub pull request files do not satisfy DiffSchema", {
        cause: result.error,
      });
    }
    return result.data;
  } catch (error) {
    if (error instanceof DiffFetchError) {
      throw error;
    }
    throw new DiffFetchError("GitHub pull request files do not satisfy DiffSchema", {
      cause: error,
    });
  }
}

function buildFileDiff(file: GitHubPullRequestFile): string {
  const oldPath = file.previous_filename ?? file.filename;
  const fromPath = file.status === "added" ? "/dev/null" : `a/${oldPath}`;
  const toPath = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
  const modeLine = file.status === "added" ? "new file mode 100644" : undefined;
  const indexLine = `index ${ZeroSha}..${file.sha} 100644`;
  const patch = file.patch ?? `Binary files ${fromPath} and ${toPath} differ`;

  return [
    `diff --git a/${oldPath} b/${file.filename}`,
    ...(modeLine === undefined ? [] : [modeLine]),
    indexLine,
    `--- ${fromPath}`,
    `+++ ${toPath}`,
    patch,
  ].join("\n");
}
