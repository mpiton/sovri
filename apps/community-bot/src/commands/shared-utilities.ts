// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";

export type RepoRef = {
  readonly owner: string;
  readonly repo: string;
};

export const FindingMarkerPattern = /<!--\s*sovri-finding-id:\s*([A-Za-z0-9-]{1,64})\s*-->/u;
export const AlreadyExistsMessagePattern = /already(?:_| )exists/iu;
export const GitHubErrorStatusSchema = z.object({ status: z.number().int() }).passthrough();

export function githubStatusFrom(error: unknown): number | undefined {
  const result = GitHubErrorStatusSchema.safeParse(error);
  return result.success ? result.data.status : undefined;
}

export function isGithubAlreadyExistsError(error: unknown): boolean {
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

export function splitRepoFullName(
  repoFullName: string | undefined,
  createError: (message: string) => Error,
): RepoRef {
  if (repoFullName === undefined) {
    throw createError("Repository full name is missing");
  }

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
    throw createError("Repository full name is invalid");
  }

  return { owner, repo };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readNumberProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): number | undefined {
  const value = record[property];
  return typeof value === "number" ? value : undefined;
}

export function readStringProperty(
  record: Readonly<Record<string, unknown>>,
  property: string,
): string | undefined {
  const value = record[property];
  return typeof value === "string" ? value : undefined;
}
