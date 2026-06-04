// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Diff, Review } from "@sovri/review-engine";

import { createPullRequestHandlerDependencies } from "../../src/github/pull-request-review.js";
import type { PullRequestWebhookContext } from "../../src/handlers/pull-request.js";

type LoggerCall = {
  readonly bindings: Readonly<Record<string, unknown>> | undefined;
  readonly message: string;
};

type TestLogger = {
  readonly error: (
    bindingsOrMessage: Readonly<Record<string, unknown>> | string,
    message?: string,
  ) => void;
  readonly info: (
    bindingsOrMessage: Readonly<Record<string, unknown>> | string,
    message?: string,
  ) => void;
};

const loggerHarness = vi.hoisted(
  (): {
    readonly calls: {
      readonly error: LoggerCall[];
      readonly info: LoggerCall[];
    };
    readonly logger: TestLogger;
  } => {
    const calls: { error: LoggerCall[]; info: LoggerCall[] } = { error: [], info: [] };

    function record(
      target: "error" | "info",
      bindingsOrMessage: Readonly<Record<string, unknown>> | string,
      message: string | undefined,
    ): void {
      if (typeof bindingsOrMessage === "string") {
        calls[target].push({ bindings: undefined, message: bindingsOrMessage });
        return;
      }

      calls[target].push({ bindings: bindingsOrMessage, message: message ?? "" });
    }

    return {
      calls,
      logger: {
        error(bindingsOrMessage, message) {
          record("error", bindingsOrMessage, message);
        },
        info(bindingsOrMessage, message) {
          record("info", bindingsOrMessage, message);
        },
      },
    };
  },
);

vi.mock("@sovri/observability", () => ({
  createLogger: () => loggerHarness.logger,
}));

const RepoFullName = "mpiton/sovri";
const BaseSha = "dddddddddddddddddddddddddddddddddddddddd";
const ReviewedHeadSha = "0123456789abcdef0123456789abcdef01234567";
const PullNumber = 42;
const GitHubToken = ["ghp", "_", "0123456789abcdef0123456789abcdef0123"].join("");
const LlmKey = ["sk", "-", "llm-provider-test-key", "-", "0123456789abcdef"].join("");
const RawWebhookPayload = '{"action":"opened","pull_request":{"id":7}}';

type CheckRunCreateParameters = {
  readonly conclusion: string;
  readonly head_sha: string;
  readonly name: string;
  readonly output: {
    readonly summary: string;
    readonly title: string;
  };
  readonly owner: string;
  readonly repo: string;
  readonly status: string;
};

type ChecksOctokit = PullRequestWebhookContext["octokit"] & {
  readonly rest: PullRequestWebhookContext["octokit"]["rest"] & {
    readonly checks: {
      readonly create: (
        parameters: CheckRunCreateParameters,
      ) => Promise<{ readonly data: { readonly id: number } }>;
    };
  };
};

type ChecksWebhookContext = Omit<PullRequestWebhookContext, "octokit"> & {
  readonly octokit: ChecksOctokit;
};

type ChecksRuntime = {
  readonly checkRequests: CheckRunCreateParameters[];
  readonly context: ChecksWebhookContext;
  readonly reviewRequests: unknown[];
};

beforeEach(() => {
  loggerHarness.calls.error.length = 0;
  loggerHarness.calls.info.length = 0;
});

describe("pull request GitHub checks adapter (R-06)", () => {
  it("posts only descriptor text in GitHub Checks output", async () => {
    // Given the mapped "Sovri / review" descriptor title is "Sovri review completed"
    // And the mapped "Sovri / review" descriptor summary is "1 finding found."
    const runtime = buildRuntime({
      deliveryId: "delivery-125",
      failingCheckStatuses: new Map(),
      pullRequestBody: RawWebhookPayload,
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context);
    const review = buildReview({
      findings: [
        buildFinding({
          body: `Do not leak ${GitHubToken}, ${LlmKey}, or ${RawWebhookPayload}.`,
        }),
      ],
    });

    // When the bot posts the descriptor to GitHub Checks
    await dependencies.postReview(buildTarget(), review, buildDiff());

    const reviewCheck = checkRequest("Sovri / review", runtime.checkRequests);
    // Then the Checks API payload output title is "Sovri review completed"
    // And the Checks API payload output summary is "1 finding found."
    expect(reviewCheck.output).toEqual({
      summary: "1 finding found.",
      title: "Sovri review completed",
    });

    const postedPayload = JSON.stringify(runtime.checkRequests);
    // And the payload does not include a GitHub token
    expect(postedPayload).not.toContain(GitHubToken);
    // And the payload does not include an LLM key
    expect(postedPayload).not.toContain(LlmKey);
    // And the payload does not include a raw webhook payload
    expect(postedPayload).not.toContain(RawWebhookPayload);
  });

  it("derives the review check conclusion from the unreconciled source review", async () => {
    // Given reconciliation removed an already-posted major finding from the PR review body
    // And the original review still contains that major finding
    const runtime = buildRuntime({
      deliveryId: "delivery-124",
      failingCheckStatuses: new Map(),
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context);
    const reconciledReview = buildReview({ findings: [] });
    const sourceReview = buildReview({ findings: [buildFinding()] });

    // When the bot posts checks for the reconciled review
    await dependencies.postReview(buildTarget(), reconciledReview, buildDiff(), sourceReview);

    // Then the visible PR review has no inline findings
    expect(runtime.reviewRequests).toHaveLength(1);
    // And the "Sovri / review" check still reflects the unreconciled major finding
    expect(runtime.checkRequests).toContainEqual(
      expect.objectContaining({
        conclusion: "failure",
        name: "Sovri / review",
      }),
    );
  });

  it("logs and swallows a first checks.create rejection", async () => {
    // Given a pull request review completed for repository "mpiton/sovri"
    // And the GitHub delivery id is "delivery-122"
    // And the pull request number is 42
    // And the reviewed head SHA is "0123456789abcdef0123456789abcdef01234567"
    // And GitHub rejects the "Sovri / review" checks.create request with status 403
    const runtime = buildRuntime({
      deliveryId: "delivery-122",
      failingCheckStatuses: new Map([["Sovri / review", 403]]),
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context);

    // When the bot posts the Sovri check runs
    const result = dependencies.postReview(buildTarget(), buildReview(), buildDiff());

    // Then the bot logs a checks posting failure with delivery id "delivery-122"
    // And the log includes repository "mpiton/sovri"
    // And the log includes pull request number 42
    // And the webhook handler resolves successfully
    await expect(result).resolves.toBeUndefined();
    expect(runtime.reviewRequests).toHaveLength(1);
    expect(checkFailureLogs()).toEqual([
      expect.objectContaining({
        bindings: expect.objectContaining({
          check_name: "Sovri / review",
          delivery_id: "delivery-122",
          pr_number: 42,
          repo: "mpiton/sovri",
          status: 403,
        }),
        message: "Sovri check run posting failed",
      }),
    ]);
  });

  it("logs one later checks.create failure and still resolves", async () => {
    // Given a pull request review completed for repository "mpiton/sovri"
    // And the GitHub delivery id is "delivery-123"
    // And GitHub accepts the "Sovri / review" checks.create request
    // And GitHub rejects the "Sovri / provenance" checks.create request with status 500
    const runtime = buildRuntime({
      deliveryId: "delivery-123",
      failingCheckStatuses: new Map([["Sovri / provenance", 500]]),
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context);

    // When the bot posts the Sovri check runs
    const result = dependencies.postReview(buildTarget(), buildReview(), buildDiff());

    // Then the webhook handler resolves successfully
    // And the checks posting failure is logged once
    await expect(result).resolves.toBeUndefined();
    expect(checkFailureLogs()).toHaveLength(1);
    expect(checkFailureLogs()[0]?.bindings).toMatchObject({
      check_name: "Sovri / provenance",
      delivery_id: "delivery-123",
      pr_number: 42,
      repo: "mpiton/sovri",
      status: 500,
    });
  });
});

function checkFailureLogs(): readonly LoggerCall[] {
  return loggerHarness.calls.error.filter(
    (call) => call.message === "Sovri check run posting failed",
  );
}

function checkRequest(
  name: string,
  requests: readonly CheckRunCreateParameters[],
): CheckRunCreateParameters {
  const request = requests.find((candidate) => candidate.name === name);
  if (request === undefined) {
    throw new Error(`Check request ${name} was not posted`);
  }

  return request;
}

function buildRuntime(values: {
  readonly deliveryId: string;
  readonly failingCheckStatuses: ReadonlyMap<string, number>;
  readonly pullRequestBody?: string | null;
}): ChecksRuntime {
  const checkRequests: CheckRunCreateParameters[] = [];
  const reviewRequests: unknown[] = [];

  return {
    checkRequests,
    context: {
      id: values.deliveryId,
      name: "pull_request.opened",
      octokit: {
        async request() {
          return { data: "" };
        },
        rest: {
          checks: {
            async create(parameters) {
              checkRequests.push(parameters);
              const status = values.failingCheckStatuses.get(parameters.name);
              if (status !== undefined) {
                throw new GitHubStatusError(parameters.name, status);
              }

              return { data: { id: checkRequests.length } };
            },
          },
          issues: {
            async createComment(parameters) {
              return { data: { body: parameters.body, id: 87654 } };
            },
            async deleteComment() {
              return { data: {} };
            },
            async listComments() {
              return { data: [] };
            },
            async updateComment(parameters) {
              return { data: { body: parameters.body, id: parameters.comment_id } };
            },
          },
          pulls: {
            async createReview(parameters) {
              reviewRequests.push(parameters);
              return { data: { body: parameters.body, id: 98765 } };
            },
            async createReviewComment() {
              return { data: { id: 98766 } };
            },
            async listFiles() {
              return { data: [] };
            },
            async listReviews() {
              return { data: [] };
            },
            async updateReview(parameters) {
              return { data: { body: parameters.body, id: parameters.review_id } };
            },
          },
          repos: {
            async getContent() {
              return { data: "" };
            },
          },
        },
      },
      payload: {
        action: "opened",
        pull_request: {
          additions: 0,
          base: {
            ref: "main",
            sha: BaseSha,
          },
          body: values.pullRequestBody ?? null,
          changed_files: 0,
          deletions: 0,
          draft: false,
          head: {
            ref: "task-122",
            sha: ReviewedHeadSha,
          },
          number: PullNumber,
          title: "Wire Sovri check runs",
          user: {
            login: "octocat",
          },
        },
        repository: {
          full_name: RepoFullName,
        },
      },
    },
    reviewRequests,
  };
}

function buildTarget() {
  return {
    baseSha: BaseSha,
    commitSha: ReviewedHeadSha,
    number: PullNumber,
    repoFullName: RepoFullName,
  };
}

function buildReview(values: { readonly findings?: Review["findings"] } = {}): Review {
  return {
    completed_at: new Date("2026-06-04T10:00:01.000Z"),
    commit_sha: ReviewedHeadSha,
    findings: values.findings ?? [],
    id: "123e4567-e89b-42d3-a456-426614174001",
    llm_model: "test-model",
    llm_provider: "test-provider",
    pr_number: PullNumber,
    repo_full_name: RepoFullName,
    started_at: new Date("2026-06-04T10:00:00.000Z"),
    status: "success",
    summary: "Review complete",
    tokens_used: {
      completion: 20,
      prompt: 100,
    },
    walkthrough_markdown: "Review complete",
  };
}

function buildDiff(): Diff {
  return {
    files: [],
    unified_diff: "",
  };
}

function buildFinding(
  values: {
    readonly body?: string;
  } = {},
): Review["findings"][number] {
  return {
    body: values.body ?? "A reconciled blocking finding still exists in the source review.",
    category: "bug",
    confidence: 0.91,
    file: "apps/community-bot/src/handlers/pull-request.ts",
    id: "123e4567-e89b-42d3-a456-426614174099",
    line_end: 42,
    line_start: 42,
    severity: "major",
    source: "llm",
    title: "Reconciled blocker",
  };
}

class GitHubStatusError extends Error {
  public readonly status: number;

  public constructor(checkName: string, status: number) {
    super(`checks.create rejected for ${checkName}`);
    this.status = status;
  }
}
