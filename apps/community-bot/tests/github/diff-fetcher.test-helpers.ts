// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { DiffFetcherOctokit } from "../../src/github/diff-fetcher.js";

export const Repo = {
  owner: "octo-org",
  repo: "sovri-target",
};
export const PullNumber = 42;

export type RawBehavior =
  | {
      readonly data: string;
      readonly delayMs?: number;
      readonly kind: "success";
    }
  | {
      readonly delayMs?: number;
      readonly kind: "error";
      readonly status: number;
    };

export type PullRequestFile = {
  readonly additions: number;
  readonly deletions: number;
  readonly filename: string;
  readonly patch?: string | null;
  readonly previous_filename?: string;
  readonly sha: string;
  readonly status: string;
};

export type FakeDiffFetcher = {
  readonly listFilesCalls: readonly {
    readonly page: number;
    readonly perPage: number;
    readonly pullNumber: number;
  }[];
  readonly octokit: DiffFetcherOctokit;
  readonly rawCalls: readonly {
    readonly accept: string;
    readonly pullNumber: number;
    readonly route: string;
  }[];
};

export function createFakeDiffFetcher(values: {
  readonly pages?: readonly (readonly PullRequestFile[])[];
  readonly pageDelaysMs?: readonly number[];
  readonly raw?: RawBehavior;
}): FakeDiffFetcher {
  const rawCalls: {
    readonly accept: string;
    readonly pullNumber: number;
    readonly route: string;
  }[] = [];
  const listFilesCalls: {
    readonly page: number;
    readonly perPage: number;
    readonly pullNumber: number;
  }[] = [];

  return {
    listFilesCalls,
    octokit: {
      async request(route, parameters) {
        rawCalls.push({
          accept: parameters.headers.accept,
          pullNumber: parameters.pull_number,
          route,
        });
        const raw = values.raw ?? { data: "", kind: "success" };
        await waitFor(raw.delayMs ?? 0, parameters.request.signal);
        if (raw.kind === "error") {
          throw new GitHubStatusError(raw.status);
        }
        return { data: raw.data };
      },
      rest: {
        pulls: {
          async listFiles(parameters) {
            listFilesCalls.push({
              page: parameters.page,
              perPage: parameters.per_page,
              pullNumber: parameters.pull_number,
            });
            await waitFor(
              values.pageDelaysMs?.[parameters.page - 1] ?? 0,
              parameters.request.signal,
            );
            return { data: values.pages?.[parameters.page - 1] ?? [] };
          },
        },
      },
    },
    rawCalls,
  };
}

export function buildTextDiff(path = "src/app.ts"): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,3 @@",
    ' export const name = "sovri";',
    "+export const enabled = true;",
    ' export const mode = "review";',
  ].join("\n");
}

export function buildBinaryDiff(path = "assets/logo.png"): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644",
    `Binary files a/${path} and b/${path} differ`,
  ].join("\n");
}

export function buildFile(values: {
  readonly filename: string;
  readonly patch?: string | null;
  readonly sha?: string;
  readonly status?: string;
}): PullRequestFile {
  return {
    additions: 1,
    deletions: 0,
    filename: values.filename,
    patch: values.patch ?? "@@ -0,0 +1 @@\n+export const fallback = true;",
    sha: values.sha ?? "2222222222222222222222222222222222222222",
    status: values.status ?? "modified",
  };
}

export function buildFiles(count: number, prefix = "src/file"): PullRequestFile[] {
  return Array.from({ length: count }, (_, index) =>
    buildFile({ filename: `${prefix}-${String(index + 1)}.ts` }),
  );
}

async function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new GitHubAbortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

class GitHubStatusError extends Error {
  public override readonly name = "GitHubStatusError";

  public constructor(public readonly status: number) {
    super(`GitHub responded with ${String(status)}`);
  }
}

class GitHubAbortError extends Error {
  public override readonly name = "AbortError";
}
