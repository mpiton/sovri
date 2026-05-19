// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const RawDiffAccept = "application/vnd.github.v3.diff";
export const DiffFetchTimeoutMs = 30_000;
export const GitHubPageSize = 100;
export const MaxPullRequestFiles = 3_000;

export type GitHubRepositoryRef = {
  readonly owner: string;
  readonly repo: string;
};

export type DiffFetcherOctokit = {
  readonly request: (
    route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    parameters: RawDiffRequestParameters,
  ) => Promise<{ readonly data: unknown }>;
  readonly rest: {
    readonly pulls: {
      readonly listFiles: (
        parameters: PullRequestFilesRequestParameters,
      ) => Promise<{ readonly data: unknown }>;
    };
  };
};

type RawDiffRequestParameters = {
  readonly headers: {
    readonly accept: typeof RawDiffAccept;
  };
  readonly owner: string;
  readonly pull_number: number;
  readonly repo: string;
  readonly request: {
    readonly signal: AbortSignal;
  };
};

type PullRequestFilesRequestParameters = {
  readonly owner: string;
  readonly page: number;
  readonly per_page: typeof GitHubPageSize;
  readonly pull_number: number;
  readonly repo: string;
  readonly request: {
    readonly signal: AbortSignal;
  };
};

export class DiffFetchError extends Error {
  public override readonly name: string = "DiffFetchError";
  public readonly status: number | undefined;

  public constructor(
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
  }
}

export class DiffFetchTimeoutError extends DiffFetchError {
  public override readonly name = "DiffFetchTimeoutError";
}

export function getHttpStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
}
