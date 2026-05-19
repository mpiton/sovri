// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Diff } from "@sovri/core";
import { DiffParseError, parseUnifiedDiff } from "@sovri/review-engine";

import {
  DiffFetchError,
  DiffFetchTimeoutError,
  DiffFetchTimeoutMs,
  RawDiffAccept,
  getHttpStatus,
  type DiffFetcherOctokit,
  type GitHubRepositoryRef,
} from "./diff-fetcher-contract.js";
import { fetchDiffFromFiles } from "./diff-fetcher-files.js";

export {
  DiffFetchError,
  DiffFetchTimeoutError,
  type DiffFetcherOctokit,
  type GitHubRepositoryRef,
} from "./diff-fetcher-contract.js";

export async function fetchDiff(
  octokit: DiffFetcherOctokit,
  repo: GitHubRepositoryRef,
  prNumber: number,
): Promise<Diff> {
  return runWithTimeout((signal) => fetchDiffWithSignal(octokit, repo, prNumber, signal));
}

async function fetchDiffWithSignal(
  octokit: DiffFetcherOctokit,
  repo: GitHubRepositoryRef,
  prNumber: number,
  signal: AbortSignal,
): Promise<Diff> {
  const rawResult = await fetchRawDiff(octokit, repo, prNumber, signal);
  if (rawResult.kind === "success") {
    const parsed = parseRawDiff(rawResult.raw);
    if (parsed.kind === "success") {
      return parsed.diff;
    }
  } else if (!canFallbackFromRawError(rawResult.error)) {
    throw rawResult.error;
  }

  return fetchDiffFromFiles(octokit, repo, prNumber, signal);
}

async function runWithTimeout(action: (signal: AbortSignal) => Promise<Diff>): Promise<Diff> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new DiffFetchTimeoutError(
              `GitHub diff request timed out after ${String(DiffFetchTimeoutMs)} ms`,
            ),
          );
          controller.abort();
        }, DiffFetchTimeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof DiffFetchError) {
      throw error;
    }
    throw new DiffFetchError("GitHub diff request failed", buildErrorOptions(error));
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function fetchRawDiff(
  octokit: DiffFetcherOctokit,
  repo: GitHubRepositoryRef,
  prNumber: number,
  signal: AbortSignal,
): Promise<
  | { readonly kind: "success"; readonly raw: string }
  | { readonly error: DiffFetchError; readonly kind: "error" }
> {
  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      headers: {
        accept: RawDiffAccept,
      },
      owner: repo.owner,
      pull_number: prNumber,
      repo: repo.repo,
      request: { signal },
    });

    if (typeof response.data !== "string") {
      return {
        error: new DiffFetchError("GitHub raw diff response is not a string"),
        kind: "error",
      };
    }

    return { kind: "success", raw: response.data };
  } catch (error) {
    return {
      error: new DiffFetchError("GitHub raw diff request failed", buildErrorOptions(error)),
      kind: "error",
    };
  }
}

function buildErrorOptions(error: unknown): { readonly cause: unknown; readonly status?: number } {
  const status = getHttpStatus(error);
  if (status === undefined) {
    return { cause: error };
  }
  return { cause: error, status };
}

function parseRawDiff(
  raw: string,
): { readonly diff: Diff; readonly kind: "success" } | { readonly kind: "unparseable" } {
  try {
    return { diff: parseUnifiedDiff(raw), kind: "success" };
  } catch (error) {
    if (error instanceof DiffParseError) {
      return { kind: "unparseable" };
    }
    throw error;
  }
}

function canFallbackFromRawError(error: DiffFetchError): boolean {
  return (
    error.status === 406 ||
    error.status === 415 ||
    (error.status !== undefined && error.status >= 500)
  );
}
