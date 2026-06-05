// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createLogger } from "@sovri/observability";
import type { CheckRunDescriptor, Review } from "@sovri/review-engine";

import { splitRepoFullName } from "../commands/shared-utilities.js";
import type { PullRequestWebhookContext, ReviewPostTarget } from "../handlers/pull-request.js";
import { getHttpStatus } from "./diff-fetcher-contract.js";

const logger = createLogger("community-bot.pull-request.checks");

export type ReviewWithOptionalCheckRunDescriptors = Review & {
  readonly check_run_descriptors?: readonly CheckRunDescriptor[];
};

export async function postCheckRuns(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  review: ReviewWithOptionalCheckRunDescriptors,
): Promise<void> {
  const checks = context.octokit.rest.checks;
  if (checks === undefined) {
    return;
  }

  const descriptors = requireCheckRunDescriptors(review);
  const repo = splitRepoFullName(target.repoFullName, createPullRequestChecksAdapterError);

  await Promise.all(
    descriptors.map((descriptor) => postCheckRun(context, target, repo, descriptor)),
  );
}

function requireCheckRunDescriptors(
  review: ReviewWithOptionalCheckRunDescriptors,
): readonly CheckRunDescriptor[] {
  const descriptors = review.check_run_descriptors;
  if (descriptors === undefined) {
    throw new PullRequestChecksAdapterError("Review check descriptors are unavailable");
  }

  return descriptors;
}

async function postCheckRun(
  context: PullRequestWebhookContext,
  target: ReviewPostTarget,
  repo: { readonly owner: string; readonly repo: string },
  descriptor: CheckRunDescriptor,
): Promise<void> {
  const checks = context.octokit.rest.checks;
  if (checks === undefined) {
    return;
  }

  try {
    await checks.create({
      conclusion: descriptor.conclusion,
      head_sha: target.commitSha,
      name: descriptor.name,
      output: {
        summary: descriptor.summary,
        title: descriptor.title,
      },
      owner: repo.owner,
      repo: repo.repo,
      status: descriptor.status,
    });
  } catch (error) {
    logger.error(
      {
        check_name: descriptor.name,
        delivery_id: context.id,
        error_type: errorTypeFrom(error),
        pr_number: target.number,
        repo: target.repoFullName,
        status: getHttpStatus(error),
      },
      "Sovri check run posting failed",
    );
  }
}

function errorTypeFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  return "NonErrorThrow";
}

class PullRequestChecksAdapterError extends Error {
  public override readonly name = "PullRequestChecksAdapterError";
}

function createPullRequestChecksAdapterError(message: string): PullRequestChecksAdapterError {
  return new PullRequestChecksAdapterError(message);
}
