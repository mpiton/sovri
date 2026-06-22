// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it, vi } from "vitest";

import type {
  PullRequestOctokit,
  PullRequestWebhookContext,
  ReviewPostTarget,
} from "../handlers/pull-request.js";
import { createPullRequestHandlerDependencies } from "./pull-request-review.js";

const VALID_CONFIG = [
  "llm:",
  "  provider: anthropic",
  "  model: claude-3-5-sonnet-latest",
  "  apiKeySecret: ANTHROPIC_API_KEY",
  "",
].join("\n");

const INVALID_CONFIG = `${VALID_CONFIG}unknownTopLevelKey: oops\n`;

class NotFoundError extends Error {
  public readonly status = 404;
}

type GetContent = PullRequestOctokit["rest"]["repos"]["getContent"];
type GetContentParams = Parameters<GetContent>[0];

const unused = async (): Promise<never> => {
  throw new Error("octokit method not used in config-load test");
};

function buildContext(getContent: GetContent): PullRequestWebhookContext {
  const octokit = {
    graphql: unused,
    rest: {
      checks: { create: unused },
      issues: {
        createComment: unused,
        deleteComment: unused,
        listComments: unused,
        updateComment: unused,
      },
      pulls: {
        createReview: unused,
        createReviewComment: unused,
        listReviews: unused,
        updateReview: unused,
      },
      repos: { getContent },
    },
  } satisfies PullRequestOctokit;

  return {
    id: "delivery-2658",
    name: "pull_request",
    octokit,
    payload: {
      action: "synchronize",
      pull_request: {},
      repository: { full_name: "acme/payments" },
    },
  } satisfies PullRequestWebhookContext;
}

describe("loadRepositoryConfig reads repository config from the base branch tip (R-01)", () => {
  // Scenario Outline: Config is fetched at the base branch tip for any base branch
  it.each([
    { base_ref: "main", base_sha: "b45e000" },
    { base_ref: "develop", base_sha: "d77c111" },
  ])(
    "fetches .sovri.yml at heads/$base_ref, not the frozen base.sha $base_sha",
    async ({ base_ref, base_sha }) => {
      // Given a pull request #42 in "acme/payments" targeting base branch "<base_ref>"
      // And the pull request's frozen base.sha is "<base_sha>"
      // And "heads/<base_ref>" holds a valid ".sovri.yml"
      const getContent = vi.fn(async (_parameters: GetContentParams) => ({ data: VALID_CONFIG }));
      const context = buildContext(getContent);
      const target = {
        baseRef: base_ref,
        baseSha: base_sha,
        commitSha: "head999",
        number: 42,
        repoFullName: "acme/payments",
      } satisfies ReviewPostTarget;

      // When the bot loads the repository config for the review
      await createPullRequestHandlerDependencies(context, {}).loadConfig(target);

      // Then it requests ".sovri.yml" at ref "heads/<base_ref>"
      expect(getContent).toHaveBeenCalledTimes(1);
      const parameters = getContent.mock.calls[0]?.[0];
      expect(parameters?.path).toBe(".sovri.yml");
      expect(parameters?.ref).toBe(`heads/${base_ref}`);
      // And it does not request ".sovri.yml" at ref "<base_sha>"
      expect(parameters?.ref).not.toBe(base_sha);
    },
  );
});

describe("config absent at the base branch tip falls back to the deployment default (R-01)", () => {
  // Scenario: Config absent at the base branch tip falls back to the deployment default
  it("requests heads/main, receives 404, resolves the deployment default config", async () => {
    // Given ".sovri.yml" does not exist at "heads/main"
    const getContent = vi.fn(async (_parameters: GetContentParams) => {
      throw new NotFoundError();
    });
    const context = buildContext(getContent);
    const target = {
      baseRef: "main",
      baseSha: "b45e000",
      commitSha: "head999",
      number: 42,
      repoFullName: "acme/payments",
    } satisfies ReviewPostTarget;

    // When the bot loads the repository config for the review
    const config = await createPullRequestHandlerDependencies(context, {
      ANTHROPIC_API_KEY: "test-key",
      SOVRI_DEFAULT_LLM_PROVIDER: "anthropic",
    }).loadConfig(target);

    // Then it requested ".sovri.yml" at ref "heads/main" and fell back to the default
    expect(getContent.mock.calls[0]?.[0]?.ref).toBe("heads/main");
    expect(config.llm.provider).toBe("anthropic");
  });
});

describe("a base-branch config fix reaches already-open pull requests (R-02)", () => {
  // Scenario: Fix on the base branch tip is honored despite a broken snapshot
  it("loads the valid config from heads/main even when base.sha holds a broken file", async () => {
    // Given ".sovri.yml" at "b45e000" is invalid and ".sovri.yml" at "heads/main" is valid
    const byRef: Readonly<Record<string, string>> = {
      b45e000: INVALID_CONFIG,
      "heads/main": VALID_CONFIG,
    };
    const getContent = vi.fn(async (parameters: GetContentParams) => ({
      data: byRef[parameters.ref] ?? "",
    }));
    const context = buildContext(getContent);
    const target = {
      baseRef: "main",
      baseSha: "b45e000",
      commitSha: "head999",
      number: 42,
      repoFullName: "acme/payments",
    } satisfies ReviewPostTarget;

    // When the bot re-reviews the pull request
    const config = await createPullRequestHandlerDependencies(context, {}).loadConfig(target);

    // Then the review loaded the config from "heads/main" and completed
    expect(getContent.mock.calls[0]?.[0]?.ref).toBe("heads/main");
    expect(config.llm.provider).toBe("anthropic");
  });

  // Scenario: Config still broken at the base branch tip fails config_load legitimately
  it("fails config_load when heads/main itself is invalid", async () => {
    // Given ".sovri.yml" at "heads/main" is invalid
    const getContent = vi.fn(async (_parameters: GetContentParams) => ({ data: INVALID_CONFIG }));
    const context = buildContext(getContent);
    const target = {
      baseRef: "main",
      baseSha: "b45e000",
      commitSha: "head999",
      number: 42,
      repoFullName: "acme/payments",
    } satisfies ReviewPostTarget;

    // When the bot re-reviews the pull request, config_load fails legitimately
    await expect(
      createPullRequestHandlerDependencies(context, {}).loadConfig(target),
    ).rejects.toThrow();
  });
});

describe("repository config is never read from the pull request head (R-03)", () => {
  // Scenario: Head config is ignored, base branch tip config is used
  it("requests heads/main and never the head sha", async () => {
    // Given "heads/main" holds a strict config and "head999" holds a permissive one
    const byRef: Readonly<Record<string, string>> = {
      head999: VALID_CONFIG,
      "heads/main": VALID_CONFIG,
    };
    const getContent = vi.fn(async (parameters: GetContentParams) => ({
      data: byRef[parameters.ref] ?? "",
    }));
    const context = buildContext(getContent);
    const target = {
      baseRef: "main",
      baseSha: "b45e000",
      commitSha: "head999",
      number: 42,
      repoFullName: "acme/payments",
    } satisfies ReviewPostTarget;

    // When the bot loads the repository config for the review
    await createPullRequestHandlerDependencies(context, {}).loadConfig(target);

    // Then it requested "heads/main" and never "head999"
    const refs = getContent.mock.calls.map((call) => call[0]?.ref);
    expect(refs).toContain("heads/main");
    expect(refs).not.toContain("head999");
  });

  // Scenario: A permissive head config cannot disable the review
  it("ignores a permissive head config and never reads the head sha", async () => {
    // Given "head999" holds a ".sovri.yml" that would disable reviews
    const getContent = vi.fn(async (_parameters: GetContentParams) => ({ data: VALID_CONFIG }));
    const context = buildContext(getContent);
    const target = {
      baseRef: "main",
      baseSha: "b45e000",
      commitSha: "head999",
      number: 42,
      repoFullName: "acme/payments",
    } satisfies ReviewPostTarget;

    // When the bot loads the repository config for the review
    await createPullRequestHandlerDependencies(context, {}).loadConfig(target);

    // Then it never requested ".sovri.yml" at ref "head999"
    const refs = getContent.mock.calls.map((call) => call[0]?.ref);
    expect(refs).not.toContain("head999");
  });
});
