// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, type SovriConfig } from "@sovri/config";
import type { Diff, Review } from "@sovri/review-engine";

import { createPullRequestHandlerDependencies } from "../../src/github/pull-request-review.js";
import type { PullRequestWebhookContext } from "../../src/handlers/pull-request.js";

const RepoFullName = "mpiton/sovri";
const BaseSha = "dddddddddddddddddddddddddddddddddddddddd";
const HeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("pull request GitHub adapter", () => {
  it("loads repository configuration from .sovri.yml on the delivered base SHA", async () => {
    const runtime = buildRuntimeContext({
      configContent: `
llm:
  provider: anthropic
  model: claude-3-5-sonnet-latest
  apiKeySecret: ANTHROPIC_API_KEY
review:
  autoReviewDrafts: true
`,
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });

    const config = await dependencies.loadConfig(buildTarget());

    expect(config.review.autoReviewDrafts).toBe(true);
    expect(runtime.contentRequests).toEqual([
      expect.objectContaining({
        mediaType: { format: "raw" },
        owner: "mpiton",
        path: ".sovri.yml",
        ref: BaseSha,
        repo: "sovri",
      }),
    ]);
  });

  it("falls back to default configuration when .sovri.yml is absent", async () => {
    const runtime = buildRuntimeContext({ missingConfig: true });
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });

    await expect(dependencies.loadConfig(buildTarget())).resolves.toEqual(DEFAULT_CONFIG);
  });

  it("fetches the diff from the pull request raw diff endpoint", async () => {
    const runtime = buildRuntimeContext({
      diffContent: [
        "diff --git a/apps/community-bot/src/handlers/pull-request.ts b/apps/community-bot/src/handlers/pull-request.ts",
        "index eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee..ffffffffffffffffffffffffffffffffffffffff 100644",
        "--- a/apps/community-bot/src/handlers/pull-request.ts",
        "+++ b/apps/community-bot/src/handlers/pull-request.ts",
        "@@ -1 +1,2 @@",
        "-old",
        "+new",
        "+line",
      ].join("\n"),
    });
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });

    const diff = await dependencies.fetchDiff(buildTarget());

    expect(diff.files[0]?.path).toBe("apps/community-bot/src/handlers/pull-request.ts");
    expect(runtime.diffRequests).toEqual([
      {
        parameters: expect.objectContaining({
          headers: { accept: "application/vnd.github.v3.diff" },
          owner: "mpiton",
          pull_number: 41,
          repo: "sovri",
        }),
        route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      },
    ]);
  });

  it("creates provider options from the configured model", () => {
    const runtime = buildRuntimeContext();
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });
    const config = buildConfig({ model: "claude-3-5-sonnet-latest" });

    const options = dependencies.buildReviewOptions?.(config);

    expect(options?.provider.model).toBe("claude-3-5-sonnet-latest");
  });

  it("posts walkthrough and inline finding comments in the PR review", async () => {
    const runtime = buildRuntimeContext();
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });

    await dependencies.postReview(buildTarget(), buildReview(), buildDiff());

    expect(runtime.reviewRequests).toEqual([
      expect.objectContaining({
        body: "<!-- sovri:walkthrough -->\nReview complete",
        comments: [
          {
            body: "**Delegation check**\n\nThe handler should delegate review work.",
            line: 42,
            path: "apps/community-bot/src/handlers/pull-request.ts",
            side: "RIGHT",
          },
        ],
        commit_id: HeadSha,
        event: "COMMENT",
        owner: "mpiton",
        pull_number: 41,
        repo: "sovri",
      }),
    ]);
  });

  it("filters unanchorable findings before posting inline review comments", async () => {
    const runtime = buildRuntimeContext();
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });
    const review = buildReview({
      findings: [
        buildFinding({
          body: "The handler should anchor a range only when every line is in the diff.",
          lineEnd: 43,
          title: "Multi-line anchor",
        }),
        buildFinding({
          body: "This line is outside the delivered diff.",
          lineStart: 999,
          lineEnd: 999,
          title: "Unanchorable finding",
        }),
      ],
    });

    await dependencies.postReview(buildTarget(), review, buildDiff());

    expect(runtime.reviewRequests).toEqual([
      expect.objectContaining({
        comments: [
          {
            body: "**Multi-line anchor**\n\nThe handler should anchor a range only when every line is in the diff.",
            line: 43,
            path: "apps/community-bot/src/handlers/pull-request.ts",
            side: "RIGHT",
            start_line: 42,
            start_side: "RIGHT",
          },
        ],
      }),
    ]);
  });

  it("rejects repository names with extra path segments", async () => {
    const runtime = buildRuntimeContext();
    const dependencies = createPullRequestHandlerDependencies(runtime.context, {
      ANTHROPIC_API_KEY: "test-key",
    });

    await expect(
      dependencies.postErrorComment(
        { ...buildTarget(), repoFullName: "mpiton/sovri/extra" },
        "review failed",
      ),
    ).rejects.toThrow("Repository full name is invalid");
  });
});

function buildRuntimeContext(
  values: {
    readonly configContent?: string;
    readonly diffContent?: string;
    readonly missingConfig?: boolean;
  } = {},
): {
  readonly context: PullRequestWebhookContext;
  readonly contentRequests: unknown[];
  readonly diffRequests: {
    readonly parameters: unknown;
    readonly route: string;
  }[];
  readonly reviewRequests: unknown[];
} {
  const contentRequests: unknown[] = [];
  const diffRequests: {
    readonly parameters: unknown;
    readonly route: string;
  }[] = [];
  const reviewRequests: unknown[] = [];

  return {
    contentRequests,
    context: {
      id: "8f1b9c2d-3e4f-45a6-91b2-123456789abc",
      name: "pull_request.opened",
      octokit: {
        async request(route, parameters) {
          diffRequests.push({ parameters, route });
          return { data: values.diffContent ?? "" };
        },
        rest: {
          issues: {
            async createComment(parameters) {
              return { data: { body: parameters.body, id: 87654 } };
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
            async listReviews() {
              return { data: [] };
            },
            async updateReview(parameters) {
              return { data: { body: parameters.body, id: parameters.review_id } };
            },
            async listFiles() {
              return { data: [] };
            },
          },
          repos: {
            async getContent(parameters) {
              contentRequests.push(parameters);
              if (values.missingConfig === true) {
                throw new GitHubNotFoundError();
              }

              return { data: values.configContent ?? "" };
            },
          },
        },
      },
      payload: {
        action: "opened",
        pull_request: {
          additions: 12,
          base: {
            ref: "main",
            sha: BaseSha,
          },
          body: "Implement pull request handlers.",
          changed_files: 1,
          deletions: 3,
          draft: false,
          head: {
            ref: "task-41",
            sha: HeadSha,
          },
          number: 41,
          title: "Implement handlers/pull-request.ts",
          user: {
            login: "octocat",
          },
        },
        repository: {
          full_name: RepoFullName,
        },
      },
    },
    diffRequests,
    reviewRequests,
  };
}

function buildTarget() {
  return {
    baseSha: BaseSha,
    commitSha: HeadSha,
    number: 41,
    repoFullName: RepoFullName,
  };
}

function buildDiff(): Diff {
  const header = "@@ -42,1 +42,2 @@";
  const patch = [
    "diff --git a/apps/community-bot/src/handlers/pull-request.ts b/apps/community-bot/src/handlers/pull-request.ts",
    `index ${"e".repeat(40)}..${"f".repeat(40)} 100644`,
    "--- a/apps/community-bot/src/handlers/pull-request.ts",
    "+++ b/apps/community-bot/src/handlers/pull-request.ts",
    header,
    "-old",
    "+new",
    "+line",
  ].join("\n");

  return {
    files: [
      {
        additions: 2,
        deletions: 1,
        hunks: [
          {
            header,
            lines: ["-old", "+new", "+line"],
            new_lines: 2,
            new_start: 42,
            old_lines: 1,
            old_start: 42,
          },
        ],
        patch,
        path: "apps/community-bot/src/handlers/pull-request.ts",
        sha: "ffffffffffffffffffffffffffffffffffffffff",
        status: "modified",
      },
    ],
    unified_diff: patch,
  };
}

function buildConfig(values: { readonly model: string }): SovriConfig {
  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      model: values.model,
    },
  };
}

function buildReview(values: { readonly findings?: Review["findings"] } = {}): Review {
  return {
    completed_at: new Date("2026-05-18T10:00:01.000Z"),
    commit_sha: HeadSha,
    findings: values.findings ?? [buildFinding()],
    id: "123e4567-e89b-42d3-a456-426614174001",
    llm_model: "test-model",
    llm_provider: "test-provider",
    pr_number: 41,
    repo_full_name: RepoFullName,
    started_at: new Date("2026-05-18T10:00:00.000Z"),
    status: "success",
    summary: "Review complete",
    tokens_used: {
      completion: 20,
      prompt: 100,
    },
    walkthrough_markdown: "Review complete",
  };
}

function buildFinding(
  values: {
    readonly body?: string;
    readonly lineEnd?: number;
    readonly lineStart?: number;
    readonly title?: string;
  } = {},
): Review["findings"][number] {
  return {
    body: values.body ?? "The handler should delegate review work.",
    category: "maintainability",
    confidence: 0.95,
    file: "apps/community-bot/src/handlers/pull-request.ts",
    id: "123e4567-e89b-42d3-a456-426614174000",
    line_end: values.lineEnd ?? 42,
    line_start: values.lineStart ?? 42,
    severity: "major",
    source: "llm",
    title: values.title ?? "Delegation check",
  };
}

class GitHubNotFoundError extends Error {
  public readonly status = 404;
}
