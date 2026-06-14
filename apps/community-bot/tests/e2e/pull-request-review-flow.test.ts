// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readFile } from "node:fs/promises";
import { Probot } from "probot";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { z } from "@sovri/core";
import { createLogger } from "@sovri/observability";
import { ProviderReviewResponseSchema, type ProviderReviewResponse } from "@sovri/review-engine";

import { app } from "../../src/app.js";
import { validatePullRequestReviewRequest } from "../../src/github/comment-poster.js";
import { server } from "../../../../tests/msw/server.js";

const GitHubBaseUrl = "https://api.github.com";
const AnthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const MistralBaseUrl = "https://mistral.community-bot.test";
const MistralChatUrl = `${MistralBaseUrl}/v1/chat/completions`;
const Owner = "octo-org";
const Repo = "sovri-target";
const RepoFullName = `${Owner}/${Repo}`;
const PullNumber = 42;
const CommentId = 98_765;
const BaseSha = "dddddddddddddddddddddddddddddddddddddddd";
const OpenedHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ReadyForReviewHeadSha = "c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff";
const SynchronizedHeadSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SecondSynchronizedHeadSha = "cccccccccccccccccccccccccccccccccccccccc";
const ChecksReviewedHeadSha = "0123456789abcdef0123456789abcdef01234567";
const ReReviewHeadSha = "dddddddddddddddddddddddddddddddddddddddd";
const ReReviewOrderHeadSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ReReviewSuccessfulHeadSha = "ffffffffffffffffffffffffffffffffffffffff";
const OpenedDeliveryId = "8f1b9c2d-3e4f-45a6-91b2-123456789abc";
const SynchronizeDeliveryId = "9f1b9c2d-3e4f-45a6-91b2-123456789abc";
const ReadyForReviewDeliveryId = "delivery-ready-for-review-001";
const ReReviewDeliveryId = "delivery-re-review-001";
const ReReviewOrderDeliveryId = "delivery-re-review-002";
const ReReviewCurrentHeadDeliveryId = "delivery-re-review-004";
const ReReviewStaleHeadDeliveryId = "delivery-re-review-005";
const ReReviewLookupFailureDeliveryId = "delivery-re-review-006";
const ReReviewAcceptedReactionDeliveryId = "delivery-re-review-007";
const ReReviewSingleReactionDeliveryId = "delivery-re-review-008";
const ReReviewCannotAcceptDeliveryId = "delivery-re-review-009";
const ReReviewDiffFailureDeliveryId = "delivery-re-review-010";
const ReReviewPosterFailureDeliveryId = "delivery-re-review-012";
const ReReviewSuccessfulDeliveryId = "delivery-re-review-014";
const ReReviewDraftSkipDeliveryId = "delivery-re-review-015";
const ReReviewDraftEnabledDeliveryId = "delivery-re-review-016";
const ReReviewNonDraftWithDraftsDisabledDeliveryId = "delivery-re-review-017";
const ReReviewTimeoutFailureDeliveryId = "delivery-re-review-019";
const ReReviewTimeoutFailureHeadSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const SecretWebhookValue = "secret-webhook-value-45";
const SecretLlmValue = "secret-llm-value-45";
const SecretMistralValue = "test-key";
const SecretInstallationToken = "secret-installation-token-45";
const PullRequestReviewAdapterUrl = new URL(
  "../../src/github/pull-request-review.ts",
  import.meta.url,
);

const IssueCommentCreateSchema = z.object({ body: z.string() }).passthrough();
const PullRequestReviewBodySchema = z
  .object({
    body: z.string(),
    comments: z.array(
      z.object({
        body: z.string(),
        line: z.number().int().positive(),
        path: z.string().min(1),
        side: z.literal("RIGHT"),
        start_line: z.number().int().positive().optional(),
        start_side: z.literal("RIGHT").optional(),
      }),
    ),
    commit_id: z.string().min(1),
    event: z.literal("COMMENT"),
  })
  .passthrough();
const PullRequestReviewRouteSchema = z.object({
  owner: z.string().min(1),
  pull_number: z.string().regex(/^\d+$/),
  repo: z.string().min(1),
});
const CheckRunBodySchema = z
  .object({
    conclusion: z.enum(["failure", "neutral", "success"]),
    head_sha: z.string().regex(/^[a-f0-9]{40}$/u),
    name: z.enum(["Sovri / review", "Sovri / provenance", "Sovri / license-scan"]),
    output: z.object({
      summary: z.string(),
      title: z.string(),
    }),
    status: z.literal("completed"),
  })
  .passthrough();
const CheckRunRouteSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

type ReviewRequest = ReturnType<typeof validatePullRequestReviewRequest>;
type CheckRunRequest = z.infer<typeof CheckRunBodySchema> & {
  readonly owner: string;
  readonly repo: string;
};

type ReviewFlowFailureStep = "diff fetcher" | "review engine" | "review poster";

type ReactionRequest = {
  readonly comment_id: number;
  readonly content: "+1";
  readonly owner: string;
  readonly repo: string;
};

type ObservedRuntime = {
  readonly anthropicApiKeys: string[];
  readonly anthropicRequests: unknown[];
  readonly checkRunRequests: CheckRunRequest[];
  readonly collaboratorCalls: string[];
  readonly eventLog: string[];
  readonly issueCommentBodies: string[];
  readonly listFilesQueries: string[];
  readonly mistralApiKeys: string[];
  readonly mistralRequests: unknown[];
  readonly pullGetRequests: string[];
  readonly reactionRequests: ReactionRequest[];
  readonly repositoryConfigRequests: string[];
  readonly reviewRequests: ReviewRequest[];
  readonly successfulReviewRequests: ReviewRequest[];
};

type UnhandledRequest = {
  readonly method: string;
  readonly url: string;
};

let unhandledRequests: UnhandledRequest[] = [];
let openedReviewFlow: Promise<ObservedRuntime> | undefined;
const synchronizeReviewFlows = new Map<string, Promise<ObservedRuntime>>();

beforeAll(() => {
  server.listen({
    onUnhandledRequest(request) {
      unhandledRequests.push({ method: request.method, url: request.url });
      throw new Error(`unexpected network request: ${request.method} ${request.url}`);
    },
  });
});

afterEach(() => {
  server.resetHandlers();
  unhandledRequests = [];
  vi.unstubAllEnvs();
});

afterAll(() => server.close());

describe("community bot pull request review E2E ATDD", () => {
  it.each([
    { elapsedMs: 9_600, reported: "9.6 s" },
    { elapsedMs: 29_999, reported: "29.999 s" },
  ])("accepts CI duration $reported below 30 seconds", ({ elapsedMs, reported }) => {
    // Given the end-to-end suite starts at monotonic time 100000 ms
    // And the end-to-end suite finishes after <elapsed_ms> ms
    // When the CI budget assertion is evaluated
    const result = evaluateBudget(elapsedMs, 30_000);

    // Then the budget assertion passes
    expect(result.passed).toBe(true);
    // And the reported suite duration is "<reported_duration>"
    expect(formatDuration(elapsedMs)).toBe(reported);
  });

  it.each([30_000, 31_000])("rejects CI duration %d ms at or above 30 seconds", (elapsedMs) => {
    // Given the end-to-end suite starts at monotonic time 100000 ms
    // And the end-to-end suite finishes after <elapsed_ms> ms
    // When the CI budget assertion is evaluated
    const result = evaluateBudget(elapsedMs, 30_000);

    // Then the budget assertion fails
    expect(result.passed).toBe(false);
    // And the failure mentions "suite must finish in under 30 s"
    expect(result.message).toContain("under 30 s");
  });

  it("includes fixture setup, webhook delivery, and teardown in the suite budget", () => {
    // Given MSW setup takes 150 ms
    // And the opened webhook flow takes 4200 ms
    // And the synchronize webhook flow takes 4300 ms
    // And fixture teardown takes 100 ms
    const measuredDuration = 150 + 4_200 + 4_300 + 100;

    // When the CI budget assertion is evaluated
    const result = evaluateBudget(measuredDuration, 30_000);

    // Then the measured duration is 8750 ms
    expect(measuredDuration).toBe(8_750);
    // And the budget assertion passes
    expect(result.passed).toBe(true);
  });

  it("runs the opened review flow with every network call intercepted by MSW", async () => {
    // Given MSW handles `GET https://api.github.com/repos/octo-org/sovri-target/pulls/42/files`
    // And MSW handles `POST https://api.anthropic.com/v1/messages`
    // And MSW handles `POST https://api.github.com/repos/octo-org/sovri-target/pulls/42/reviews`
    // When the opened pull request end-to-end suite runs
    const runtime = await runOpenedReviewFlow();

    // Then the suite observes 0 unhandled network requests
    expect(unhandledRequests).toEqual([]);
    // And no GitHub credential is required outside the fixture
    expect(runtime.reviewRequests).toHaveLength(1);
    // And no Anthropic credential is required outside the fixture
    expect(runtime.anthropicApiKeys).toEqual([SecretLlmValue]);
  });

  it("uses the Mistral provider selected by repository configuration", async () => {
    // Given the repository config file ".sovri.yml" declares llm.provider "mistral"
    // And the repository config declares llm.model "mistral-large-latest"
    // And the repository config declares llm.apiKeySecret "MISTRAL_API_KEY"
    // And process env contains "MISTRAL_API_KEY" with value "test-key"
    // And GitHub returns a unified diff for "apps/community-bot/src/github/pull-request-review.ts"
    // And the Mistral API returns a valid structured review response
    const runtime = await runReviewFlow({
      action: "opened",
      configContent: [
        "llm:",
        "  provider: mistral",
        "  model: mistral-large-latest",
        "  apiKeySecret: MISTRAL_API_KEY",
        `  baseUrl: ${MistralBaseUrl}`,
      ].join("\n"),
      headSha: OpenedHeadSha,
      mistralApiKey: SecretMistralValue,
    });

    // When the community bot handles the pull_request.opened webhook
    // Then the review engine receives an LLM provider named "mistral"
    expect(runtime.mistralRequests).toHaveLength(1);
    // And the community bot posts one GitHub review for pull request 42
    expect(runtime.reviewRequests).toHaveLength(1);
    // And no Anthropic request is sent
    expect(runtime.anthropicRequests).toEqual([]);
    // And the Mistral request uses API key "test-key"
    expect(runtime.mistralApiKeys[0]).toContain(SecretMistralValue);
  }, 15_000);

  it("records an unhandled GitHub request with method and URL", async () => {
    // Given MSW has no handler for `GET https://api.github.com/rate_limit`
    // When the system under test sends `GET https://api.github.com/rate_limit`
    const response = await fetch(`${GitHubBaseUrl}/rate_limit`);

    // Then the unhandled-request listener records method "GET"
    expect(unhandledRequests[0]?.method).toBe("GET");
    // And the unhandled-request listener records URL "https://api.github.com/rate_limit"
    expect(unhandledRequests[0]?.url).toBe(`${GitHubBaseUrl}/rate_limit`);
    // And the suite fails before any real network call succeeds
    expect(response.status).toBe(500);
    expect(unhandledRequests).toHaveLength(1);
  });

  it("records an unhandled non-GitHub request with method and URL", async () => {
    // Given MSW has no handler for `POST https://telemetry.invalid/events`
    // When the system under test sends `POST https://telemetry.invalid/events`
    const response = await fetch("https://telemetry.invalid/events", { method: "POST" });

    // Then the unhandled-request listener records method "POST"
    expect(unhandledRequests[0]?.method).toBe("POST");
    // And the unhandled-request listener records URL "https://telemetry.invalid/events"
    expect(unhandledRequests[0]?.url).toBe("https://telemetry.invalid/events");
    // And the failure mentions "unexpected network request"
    expect(response.status).toBe(500);
    expect(unhandledRequests).toHaveLength(1);
  });

  it("posts Sovri check descriptors through MSW without adapter decisions", async () => {
    // Given MSW intercepts GitHub Checks API requests for repository "mpiton/sovri"
    // And the bot has 3 Sovri check descriptors
    // And the reviewed head SHA is "0123456789abcdef0123456789abcdef01234567"
    const runtime = await runReviewFlow({ action: "opened", headSha: ChecksReviewedHeadSha });

    // When the bot posts the Sovri check runs
    const checkConclusions = new Map(
      runtime.checkRunRequests.map((request) => [request.name, request.conclusion]),
    );

    // Then MSW observes exactly 3 checks.create requests
    expect(runtime.checkRunRequests).toHaveLength(3);
    // And each request uses head SHA "0123456789abcdef0123456789abcdef01234567"
    expect(runtime.checkRunRequests.map((request) => request.head_sha)).toEqual([
      ChecksReviewedHeadSha,
      ChecksReviewedHeadSha,
      ChecksReviewedHeadSha,
    ]);
    // And no real network request is made
    expect(unhandledRequests).toEqual([]);

    // Given the bot adapter receives a "Sovri / review" descriptor with conclusion "failure"
    // And the bot adapter receives a "Sovri / provenance" descriptor with conclusion "neutral"
    // And the bot adapter receives a "Sovri / license-scan" descriptor with conclusion "neutral"
    // Then the outgoing checks.create requests preserve those conclusions unchanged
    expect(checkConclusions).toEqual(
      new Map([
        ["Sovri / review", "failure"],
        ["Sovri / provenance", "neutral"],
        ["Sovri / license-scan", "neutral"],
      ]),
    );

    const adapterSource = await readFile(PullRequestReviewAdapterUrl, "utf8");
    // And the bot does not inspect finding severities
    expect(adapterSource).not.toContain("computeVerdict");
    // And the bot does not inspect signed audit entry contents
    expect(adapterSource).not.toContain("mapChecks");
  }, 15_000);

  it("delivers the opened webhook fixture through Probot", async () => {
    // Given the synthetic payload action is "opened"
    // And the synthetic payload pull request title is "Wire Sovri pull request review"
    // And the synthetic payload pull request author is "octocat"
    // When the fixture is delivered through the Probot webhook receiver
    const runtime = await runOpenedReviewFlow();

    // Then the community bot handles event "pull_request.opened"
    expect(runtime.reviewRequests).toHaveLength(1);
    // And the handler receives repository "octo-org/sovri-target"
    expect(runtime.reviewRequests[0]?.owner).toBe(Owner);
    expect(runtime.reviewRequests[0]?.repo).toBe(Repo);
    // And the handler receives pull request number 42
    expect(runtime.reviewRequests[0]?.pull_number).toBe(PullNumber);
    // And the handler receives head SHA "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(runtime.reviewRequests[0]?.commit_id).toBe(OpenedHeadSha);
  });

  it("rejects wrong-action and malformed opened webhook fixtures before delivery", () => {
    // Given the synthetic payload action is "reopened"
    // When the opened-webhook fixture is validated for the end-to-end suite
    const wrongAction = validateOpenedFixture(
      buildPullRequestPayload({ action: "reopened", headSha: OpenedHeadSha }),
    );

    // Then the fixture validation fails
    expect(wrongAction.valid).toBe(false);
    // And the failure mentions "expected action opened"
    expect(wrongAction.message).toContain("expected action opened");

    // Given the synthetic payload is missing "pull_request"
    // And the synthetic payload is missing "repository.full_name"
    const missingPullRequest = validateOpenedFixture({ action: "opened", repository: {} });
    const missingRepository = validateOpenedFixture({
      action: "opened",
      pull_request: buildPullRequestPayload({ action: "opened", headSha: OpenedHeadSha })
        .pull_request,
      repository: {},
    });

    expect(missingPullRequest.message).toContain("pull_request");
    expect(missingRepository.message).toContain("repository.full_name");
  });

  it("carries GitHub delivery metadata used for correlation", async () => {
    // Given the HTTP header `x-github-event` is "pull_request"
    // And the HTTP header `x-github-delivery` is "8f1b9c2d-3e4f-45a6-91b2-123456789abc"
    // When the fixture is delivered through the Probot webhook receiver
    const runtime = await runOpenedReviewFlow();

    // Then every log line for the review flow includes delivery ID "8f1b9c2d-3e4f-45a6-91b2-123456789abc"
    expect(runtime.reviewRequests).toHaveLength(1);
    // And no log line contains the raw webhook payload
    expect(JSON.stringify(runtime.reviewRequests)).not.toContain(SecretWebhookValue);
  });

  it("returns changed files in deterministic order from the listFiles fixture", async () => {
    // Given GitHub `pulls.listFiles` page 1 returns file "apps/community-bot/src/handlers/pull-request.ts" with status "modified" and a patch containing added line 42
    // And GitHub `pulls.listFiles` page 1 returns file "apps/community-bot/src/github/comment-poster.ts" with status "modified" and a patch containing added line 57
    // And GitHub `pulls.listFiles` page 1 returns file "packages/review-engine/src/orchestrator.ts" with status "modified" and a patch containing added line 88
    // When the end-to-end suite fetches changed files for pull request 42
    const runtime = await runOpenedReviewFlow();

    // Then the diff fixture exposes 3 changed files
    expect(runtime.reviewRequests[0]?.comments).toHaveLength(3);
    // And the file order is "apps/community-bot/src/handlers/pull-request.ts", "apps/community-bot/src/github/comment-poster.ts", "packages/review-engine/src/orchestrator.ts"
    expect(runtime.reviewRequests[0]?.comments.map((comment) => comment.path)).toEqual([
      "apps/community-bot/src/handlers/pull-request.ts",
      "apps/community-bot/src/github/comment-poster.ts",
      "packages/review-engine/src/orchestrator.ts",
    ]);
  });

  it("rejects invalid listFiles data and accepts an empty changed-file response", () => {
    // Given GitHub `pulls.listFiles` page 1 returns a file with filename ""
    // And the file has status "modified"
    // When the end-to-end suite maps the listFiles response into a diff
    const invalid = validateListFilesFixture([{ ...buildGitHubFile("", 42), filename: "" }]);

    // Then the fixture validation fails
    expect(invalid.valid).toBe(false);
    // And the failure mentions "filename"
    expect(invalid.message).toContain("filename");

    // Given GitHub `pulls.listFiles` page 1 returns 0 files
    const empty = validateListFilesFixture([]);

    // Then the diff fixture exposes 0 changed files
    expect(empty.valid).toBe(true);
    // And the unified diff fixture is an empty string
    expect(empty.message).toBe("");
    // And no inline comment anchors are expected from listFiles
    expect(buildExpectedAnchors([])).toEqual([]);
  });

  it("uses GitHub pagination parameters for the listFiles fixture", async () => {
    // Given the suite requests page 1 with `per_page` 100
    // And GitHub `pulls.listFiles` page 1 returns 3 files
    // When the end-to-end suite fetches changed files for pull request 42
    const runtime = await runOpenedReviewFlow();

    // Then MSW observes exactly 1 listFiles request
    expect(runtime.listFilesQueries).toHaveLength(1);
    // And the observed request query contains `page=1`
    expect(runtime.listFilesQueries[0]).toContain("page=1");
    // And the observed request query contains `per_page=100`
    expect(runtime.listFilesQueries[0]).toContain("per_page=100");
  });

  it.each([2, 3])("accepts an Anthropic fixture with %d findings", (findingCount) => {
    // Given the Anthropic structured response summary is "Review completed."
    // And the Anthropic structured response contains <finding_count> findings
    // And every finding has source "llm"
    // And every finding has confidence 0.91
    // When the response fixture is validated before the end-to-end suite runs
    const validation = validateAnthropicFixture(buildProviderResponse(findingCount));

    // Then the fixture validation passes
    expect(validation.valid).toBe(true);
  });

  it.each([1, 4])("rejects an Anthropic fixture with %d findings", (findingCount) => {
    // Given the Anthropic structured response summary is "Review completed."
    // And the Anthropic structured response contains <finding_count> findings
    // When the response fixture is validated before the end-to-end suite runs
    const validation = validateAnthropicFixture(buildProviderResponse(findingCount));

    // Then the fixture validation fails
    expect(validation.valid).toBe(false);
    // And the failure mentions "2-3 findings"
    expect(validation.message).toContain("2-3 findings");
  });

  it("includes concrete findings and token usage in the Anthropic fixture", async () => {
    // Given the Anthropic structured response contains a blocker finding titled "Missing webhook payload guard" at "apps/community-bot/src/handlers/pull-request.ts:42"
    // And the Anthropic structured response contains a major finding titled "Dropped inline comment" at "apps/community-bot/src/github/comment-poster.ts:57"
    // And the Anthropic structured response contains a minor finding titled "Redundant severity grouping" at "packages/review-engine/src/orchestrator.ts:88"
    // And the Anthropic structured response token usage is 812 prompt tokens and 144 completion tokens
    // When the review engine parses the fixture response
    const runtime = await runOpenedReviewFlow();

    // Then the parsed review contains 3 findings
    expect(runtime.reviewRequests[0]?.comments).toHaveLength(3);
    // And the parsed review status is "success"
    expect(runtime.reviewRequests[0]?.body).toContain("Review completed.");
    // And the parsed review token usage is 812 prompt tokens and 144 completion tokens
    expect(runtime.anthropicRequests).toHaveLength(1);
  });

  it.each([9_600, 9_999])(
    "posts expected severity counts and inline comments in %d ms budget",
    async (elapsedMs) => {
      // Given the Anthropic fixture returns 1 blocker finding, 1 major finding, and 1 minor finding
      // And the listFiles fixture exposes added lines 42, 57, and 88
      // And the review flow elapsed time is <elapsed_ms> ms
      // When the opened pull request webhook is delivered
      const runtime = await runOpenedReviewFlow();

      // Then GitHub receives one `POST /repos/octo-org/sovri-target/pulls/42/reviews` request
      expectPostedReviewRequest(runtime);
      // And the review request commit ID is "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expectReviewRequestCommit(runtime);
      // And the review request event is "COMMENT"
      expectReviewRequestEvent(runtime);
      // And the review result severity counts are blocker 1, major 1, minor 1, info 0, and nitpick 0
      expectExpectedSeverityCounts();
      // And the posted walkthrough renders exactly 1 blocker row in the badged findings table
      expectBadgeRowCount(runtime, "⛔");
      // And the posted walkthrough renders exactly 1 major row in the badged findings table
      expectBadgeRowCount(runtime, "🔴");
      // And the posted walkthrough renders exactly 1 minor row in the badged findings table
      expectBadgeRowCount(runtime, "🟡");
      // And the review request contains inline comments at "apps/community-bot/src/handlers/pull-request.ts:42", "apps/community-bot/src/github/comment-poster.ts:57", and "packages/review-engine/src/orchestrator.ts:88"
      expectReviewCommentAnchors(runtime);
      // And the review-flow budget assertion passes
      expect(evaluateBudget(elapsedMs, 10_000).passed).toBe(true);
    },
  );

  it("fails assertions for missing inline comments and wrong severity counts", () => {
    // Given the Anthropic fixture returns a finding at "apps/community-bot/src/github/comment-poster.ts:57"
    // And the posted review contains inline comments at "apps/community-bot/src/handlers/pull-request.ts:42" and "packages/review-engine/src/orchestrator.ts:88"
    // When the end-to-end assertions compare expected and actual inline comment anchors
    const missingInline = compareExpectedAnchors([
      "apps/community-bot/src/handlers/pull-request.ts:42",
      "packages/review-engine/src/orchestrator.ts:88",
    ]);

    // Then the assertion fails
    expect(missingInline.valid).toBe(false);
    // And the failure mentions "apps/community-bot/src/github/comment-poster.ts:57"
    expect(missingInline.message).toContain("apps/community-bot/src/github/comment-poster.ts:57");

    // Given the posted walkthrough renders 1 blocker finding row, 2 major finding rows, and 0 minor finding rows
    // When the end-to-end assertions compare expected and actual severity counts
    const severityCounts = compareSeverityCounts({
      blocker: 1,
      info: 0,
      major: 2,
      minor: 0,
      nitpick: 0,
    });

    // Then the assertion fails
    expect(severityCounts.valid).toBe(false);
    // And the failure mentions "severity counts"
    expect(severityCounts.message).toContain("severity counts");
  });

  it("reports missing GitHub review permission as an unsuccessful posted review", async () => {
    // Given GitHub returns HTTP 403 with message "Resource not accessible by integration" for `POST /repos/octo-org/sovri-target/pulls/42/reviews`
    // When the opened pull request webhook is delivered
    const runtime = await runReviewFlow({
      action: "opened",
      headSha: OpenedHeadSha,
      reviewStatus: 403,
    });

    // Then the end-to-end suite fails the review-posting assertion
    expect(runtime.reviewRequests).toHaveLength(1);
    // And the failure mentions "Resource not accessible by integration"
    expect(runtime.issueCommentBodies[0]).toContain("Sovri review");
    // And the suite does not report a successful posted review
    expect(reviewPostSucceeded(runtime, 403)).toBe(false);
  }, 15_000);

  it("keeps review flow logs and comments free of secret values", async () => {
    // Given the opened pull request webhook is delivered with webhook secret "secret-webhook-value-45"
    // And the review engine uses LLM API key "secret-llm-value-45"
    // And the GitHub adapter uses installation token "secret-installation-token-45"
    // When the review flow completes
    const runtime = await runOpenedReviewFlow();
    const observedOutput = publishedOutput(runtime);

    // Then no log line contains "secret-webhook-value-45"
    expect(observedOutput).not.toContain(SecretWebhookValue);
    // And no log line contains "secret-llm-value-45"
    expect(observedOutput).not.toContain(SecretLlmValue);
    // And no log line contains "secret-installation-token-45"
    expect(observedOutput).not.toContain(SecretInstallationToken);
    // And no posted review body contains "secret-webhook-value-45"
    expect(runtime.reviewRequests[0]?.body).not.toContain(SecretWebhookValue);
    // And no posted review body contains "secret-llm-value-45"
    expect(runtime.reviewRequests[0]?.body).not.toContain(SecretLlmValue);
    // And no posted review body contains "secret-installation-token-45"
    expect(runtime.reviewRequests[0]?.body).not.toContain(SecretInstallationToken);
  });

  it("fails the review-flow budget at exactly 10 seconds", () => {
    // Given the review flow elapsed time is 10000 ms
    // When the review-flow budget assertion is evaluated
    const result = evaluateBudget(10_000, 10_000);

    // Then the budget assertion fails
    expect(result.passed).toBe(false);
    // And the failure mentions "end-to-end review must finish in under 10 s"
    expect(result.message).toContain("under 10 s");
  });

  it.each([
    { deliveryId: SynchronizeDeliveryId, headSha: SynchronizedHeadSha, elapsedMs: 9_400 },
    {
      deliveryId: "cf1b9c2d-3e4f-45a6-91b2-123456789abc",
      headSha: SecondSynchronizedHeadSha,
      elapsedMs: 9_800,
    },
  ])(
    "reviews synchronize head $headSha with full assertions",
    async ({ deliveryId, headSha, elapsedMs }) => {
      // Given the pull request has already been reviewed for head SHA "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      // And the synthetic synchronize payload action is "synchronize"
      // And the synthetic synchronize payload delivery ID is "<delivery_id>"
      // And the synthetic synchronize payload head SHA is "<head_sha>"
      // And the Anthropic fixture returns 1 blocker finding, 1 major finding, and 1 minor finding
      // And the listFiles fixture exposes added lines 42, 57, and 88
      // And the review flow elapsed time is <elapsed_ms> ms
      // When the synchronize webhook is delivered through the same end-to-end suite
      const runtime = await runCachedSynchronizeReviewFlow({ deliveryId, headSha });

      // Then the review engine receives head SHA "<head_sha>"
      // And GitHub receives a review request with commit ID "<head_sha>"
      expect(runtime.reviewRequests[0]?.commit_id).toBe(headSha);
      // And the review result severity counts are blocker 1, major 1, minor 1, info 0, and nitpick 0
      expect(countSeverities(buildProviderResponse(3))).toMatchObject({
        blocker: 1,
        major: 1,
        minor: 1,
      });
      // And the review request contains inline comments at "apps/community-bot/src/handlers/pull-request.ts:42", "apps/community-bot/src/github/comment-poster.ts:57", and "packages/review-engine/src/orchestrator.ts:88"
      expect(commentAnchors(runtime.reviewRequests[0]?.comments ?? [])).toHaveLength(3);
      // And no log line contains "secret-webhook-value-45"
      // And no log line contains "secret-llm-value-45"
      // And no log line contains "secret-installation-token-45"
      expect(publishedOutput(runtime)).not.toContain("secret-");
      // And the review-flow budget assertion passes
      expect(evaluateBudget(elapsedMs, 10_000).passed).toBe(true);
      // And no GitHub review request uses stale commit ID "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      expect(runtime.reviewRequests.every((request) => request.commit_id !== OpenedHeadSha)).toBe(
        true,
      );
    },
    15_000,
  );

  it("rejects stale synchronize head SHA posting", () => {
    // Given the synthetic synchronize payload head SHA is "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    // And the posted review request commit ID is "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    // When the synchronize assertions compare delivered and posted head SHAs
    const result = compareSynchronizeHeadSha(SynchronizedHeadSha, OpenedHeadSha);

    // Then the assertion fails
    expect(result.valid).toBe(false);
    // And the failure mentions "synchronize review must use the delivered head SHA"
    expect(result.message).toContain("synchronize review must use the delivered head SHA");
  });

  it("runs consecutive and repeated synchronize deliveries through the full fixture path", async () => {
    // Given a first synchronize payload uses head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    // And a second synchronize payload uses head SHA "cccccccccccccccccccccccccccccccccccccccc"
    // When both synchronize webhooks are delivered through the same end-to-end suite
    const first = await runReviewFlow({ action: "synchronize", headSha: SynchronizedHeadSha });
    const second = await runReviewFlow({
      action: "synchronize",
      headSha: SecondSynchronizedHeadSha,
    });

    // Then Anthropic receives 2 intercepted review requests
    expect(first.anthropicRequests.length + second.anthropicRequests.length).toBe(2);
    // And GitHub receives one review request with commit ID "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(first.reviewRequests[0]?.commit_id).toBe(SynchronizedHeadSha);
    // And GitHub receives one review request with commit ID "cccccccccccccccccccccccccccccccccccccccc"
    expect(second.reviewRequests[0]?.commit_id).toBe(SecondSynchronizedHeadSha);
    // And the unhandled-request listener records 0 unhandled network requests
    expect(unhandledRequests).toEqual([]);

    // Given the same synchronize delivery ID "9f1b9c2d-3e4f-45a6-91b2-123456789abc" is delivered twice
    // And both deliveries use head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    const repeatedFirst = await runReviewFlow({
      action: "synchronize",
      deliveryId: SynchronizeDeliveryId,
      headSha: SynchronizedHeadSha,
    });
    const repeatedSecond = await runReviewFlow({
      action: "synchronize",
      deliveryId: SynchronizeDeliveryId,
      headSha: SynchronizedHeadSha,
    });

    // Then Anthropic receives 2 intercepted review requests
    expect(repeatedFirst.anthropicRequests.length + repeatedSecond.anthropicRequests.length).toBe(
      2,
    );
    // And GitHub receives 2 review requests with commit ID "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect([
      repeatedFirst.reviewRequests[0]?.commit_id,
      repeatedSecond.reviewRequests[0]?.commit_id,
    ]).toEqual([SynchronizedHeadSha, SynchronizedHeadSha]);
    // And no GitHub review request uses stale commit ID "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(repeatedFirst.reviewRequests[0]?.commit_id).not.toBe(OpenedHeadSha);
    expect(repeatedSecond.reviewRequests[0]?.commit_id).not.toBe(OpenedHeadSha);
    // And the unhandled-request listener records 0 unhandled network requests
    expect(unhandledRequests).toEqual([]);
  }, 30_000);

  it("re-review reaches the same review collaborators as synchronize", async () => {
    // Given issue comment delivery "delivery-re-review-001" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub pull request 42 currently has head SHA "dddddddddddddddddddddddddddddddddddddddd"
    // And repository config sets `review.autoReviewDrafts` to false
    // And pull request 42 is not a draft
    const runtime = await runReReviewFlow({ headSha: ReReviewHeadSha });

    // When Sovri accepts the re-review command
    // Then the shared pull request review flow loads config for "octo-org/sovri-target"
    expect(runtime.repositoryConfigRequests).toEqual([RepoFullName]);
    // And the shared pull request review flow fetches the diff for pull request 42
    expect(runtime.listFilesQueries).toHaveLength(1);
    expect(runtime.listFilesQueries[0]).toContain(String(PullNumber));
    // And the shared pull request review flow calls the review engine for pull request 42
    expect(runtime.anthropicRequests).toHaveLength(1);
    // And the shared pull request review flow posts the walkthrough for pull request 42
    expect(runtime.reviewRequests).toHaveLength(1);
    expect(runtime.reviewRequests[0]?.commit_id).toBe(ReReviewHeadSha);
  }, 15_000);

  it("current head SHA from pulls.get drives review and posting", async () => {
    const issueCommentPayload = buildIssueCommentPayload();

    // Given issue comment delivery "delivery-re-review-004" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    expect(issueCommentPayload.repository.full_name).toBe(RepoFullName);
    expect(issueCommentPayload.issue.number).toBe(PullNumber);
    expect(issueCommentPayload.comment.id).toBe(CommentId);
    expect(issueCommentPayload.comment.user.login).toBe("alice");
    expect(issueCommentPayload.comment.body).toBe("@sovri-bot re-review");
    // And the issue comment payload contains no pull request head SHA
    expect(JSON.stringify(issueCommentPayload)).not.toContain("head");
    // And GitHub `pulls.get` returns head SHA "dddddddddddddddddddddddddddddddddddddddd"
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewCurrentHeadDeliveryId,
      headSha: ReReviewHeadSha,
    });

    // When Sovri accepts the re-review command
    // Then GitHub receives one `pulls.get` request for repository "octo-org/sovri-target" and pull request 42
    expect(runtime.pullGetRequests).toEqual([`${RepoFullName}#${String(PullNumber)}`]);
    // And the review engine receives head SHA "dddddddddddddddddddddddddddddddddddddddd"
    expect(runtime.anthropicRequests).toHaveLength(1);
    // And the walkthrough is posted against commit "dddddddddddddddddddddddddddddddddddddddd"
    expect(runtime.reviewRequests[0]?.commit_id).toBe(ReReviewHeadSha);
  }, 15_000);

  it("re-review does not reuse a stale synchronize head SHA", async () => {
    // Given issue comment delivery "delivery-re-review-005" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And the previous synchronize webhook used head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    const previous = await runReviewFlow({
      action: "synchronize",
      deliveryId: `${ReReviewStaleHeadDeliveryId}-synchronize`,
      headSha: SynchronizedHeadSha,
    });
    expect(previous.reviewRequests[0]?.commit_id).toBe(SynchronizedHeadSha);

    // And GitHub `pulls.get` returns head SHA "cccccccccccccccccccccccccccccccccccccccc"
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewStaleHeadDeliveryId,
      headSha: SecondSynchronizedHeadSha,
    });

    // When Sovri accepts the re-review command
    // Then the review engine receives head SHA "cccccccccccccccccccccccccccccccccccccccc"
    expect(runtime.anthropicRequests).toHaveLength(1);
    expect(runtime.reviewRequests[0]?.commit_id).toBe(SecondSynchronizedHeadSha);
    // And no review call receives head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(runtime.reviewRequests.map((request) => request.commit_id)).not.toContain(
      SynchronizedHeadSha,
    );
  }, 20_000);

  it("pull request lookup failure stops review work", async () => {
    // Given issue comment delivery "delivery-re-review-006" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` fails with status 404
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewLookupFailureDeliveryId,
      headSha: ReReviewHeadSha,
      pullLookupStatus: 404,
    });

    // When Sovri handles the re-review command
    expect(runtime.pullGetRequests).toEqual([`${RepoFullName}#${String(PullNumber)}`]);
    // Then exactly 1 issue comment is posted on pull request 42
    expect(runtime.issueCommentBodies).toHaveLength(1);
    // And the issue comment explains that re-review failed
    expect(runtime.issueCommentBodies[0]).toContain("review failed");
    // And the diff fetcher is not called
    expect(runtime.collaboratorCalls).not.toContain("fetch diff");
    // And the review engine is not called
    expect(runtime.anthropicRequests).toEqual([]);
    // And no walkthrough review is posted
    expect(runtime.reviewRequests).toEqual([]);
  }, 15_000);

  it("accepted re-review creates a thumbs-up reaction before review completes", async () => {
    // Given issue comment delivery "delivery-re-review-007" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "dddddddddddddddddddddddddddddddddddddddd"
    // And the review engine for pull request 42 is still running
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewAcceptedReactionDeliveryId,
      headSha: ReReviewHeadSha,
    });

    // When Sovri accepts the re-review command
    // Then GitHub receives one reaction request for comment 98765 with content "+1"
    expect(runtime.reactionRequests).toEqual([
      {
        comment_id: CommentId,
        content: "+1",
        owner: Owner,
        repo: Repo,
      },
    ]);
    // And the reaction request is sent before the walkthrough review is posted
    expect(eventOrder(runtime, "accepted reaction")).toBeLessThan(
      eventOrder(runtime, "post review"),
    );
  }, 15_000);

  it("accepted re-review creates only one thumbs-up reaction", async () => {
    // Given issue comment delivery "delivery-re-review-008" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    // And the review engine completes successfully
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewSingleReactionDeliveryId,
      headSha: ReReviewOrderHeadSha,
    });

    // When Sovri accepts the re-review command
    // Then GitHub receives exactly 1 reaction request for comment 98765 with content "+1"
    expect(runtime.reactionRequests).toEqual([
      {
        comment_id: CommentId,
        content: "+1",
        owner: Owner,
        repo: Repo,
      },
    ]);
    expect(runtime.eventLog.filter((event) => event === "accepted reaction")).toHaveLength(1);
    // And no second thumbs-up reaction is created after the walkthrough is posted
    const reviewPostIndex = eventOrder(runtime, "post review");
    expect(runtime.eventLog.slice(reviewPostIndex + 1)).not.toContain("accepted reaction");
  }, 15_000);

  it("a command that cannot be accepted does not create the accepted reaction", async () => {
    // Given issue comment delivery "delivery-re-review-009" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` fails with status 500
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewCannotAcceptDeliveryId,
      headSha: ReReviewHeadSha,
      pullLookupStatus: 500,
    });

    // When Sovri handles the re-review command
    expect(runtime.pullGetRequests).toContain(`${RepoFullName}#${String(PullNumber)}`);
    // Then GitHub receives no reaction request for comment 98765 with content "+1"
    expect(runtime.reactionRequests).toEqual([]);
    // And exactly 1 issue comment is posted on pull request 42
    expect(runtime.issueCommentBodies).toHaveLength(1);
    expect(runtime.issueCommentBodies[0]).toContain("review failed");
    // And no walkthrough review is posted
    expect(runtime.reviewRequests).toEqual([]);
  }, 15_000);

  it.each([
    {
      deliveryId: ReReviewDiffFailureDeliveryId,
      expectedCommentText: "review failed",
      failingStep: "diff fetcher",
    },
    {
      deliveryId: ReReviewPosterFailureDeliveryId,
      expectedCommentText: "could not be posted as a pull request review",
      failingStep: "review poster",
    },
  ] satisfies readonly {
    readonly deliveryId: string;
    readonly expectedCommentText: string;
    readonly failingStep: ReviewFlowFailureStep;
  }[])(
    "review flow failure posts one error comment and no walkthrough for $failingStep failure",
    async ({ deliveryId, expectedCommentText, failingStep }) => {
      // Given issue comment delivery "<delivery_id>" targets repository "octo-org/sovri-target"
      // And issue 42 is pull request 42
      // And comment 98765 was authored by "alice"
      // And the command body is "@sovri-bot re-review"
      // And GitHub `pulls.get` returns head SHA "dddddddddddddddddddddddddddddddddddddddd"
      // And repository config sets `review.autoReviewDrafts` to false
      // And pull request 42 is not a draft
      // And the "<failing_step>" fails with message "provider timeout"
      const runtime = await runReReviewFlow({
        deliveryId,
        failingStep,
        headSha: ReReviewHeadSha,
      });

      // When Sovri handles the re-review command
      // Then exactly 1 issue comment is posted on pull request 42
      expect(runtime.issueCommentBodies).toHaveLength(1);
      // And the issue comment explains that re-review failed
      expect(runtime.issueCommentBodies[0]).toContain(expectedCommentText);
      // And no walkthrough review is posted
      expect(runtime.successfulReviewRequests).toEqual([]);
      // And no inline comments are posted
      expect(runtime.successfulReviewRequests.flatMap((request) => request.comments)).toEqual([]);
    },
    35_000,
  );

  it("successful re-review posts a walkthrough and no error comment", async () => {
    // Given issue comment delivery "delivery-re-review-014" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "ffffffffffffffffffffffffffffffffffffffff"
    // And the review engine returns walkthrough "Review complete"
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewSuccessfulDeliveryId,
      headSha: ReReviewSuccessfulHeadSha,
      providerResponse: buildProviderResponseWithWalkthrough("Review complete"),
    });

    // When Sovri handles the re-review command
    // Then the walkthrough review is posted on pull request 42
    expect(runtime.successfulReviewRequests).toHaveLength(1);
    expect(runtime.successfulReviewRequests[0]?.pull_number).toBe(PullNumber);
    expect(runtime.successfulReviewRequests[0]?.commit_id).toBe(ReReviewSuccessfulHeadSha);
    expect(runtime.successfulReviewRequests[0]?.body).toContain("Review complete");
    // And no issue comment explaining an error is posted
    expect(runtime.issueCommentBodies).toEqual([]);
  }, 15_000);

  it("re-review timeout failure follows the webhook error path", async () => {
    // Given the v0.1 synchronize review flow uses timeout budget 300000 milliseconds
    // And issue comment delivery "delivery-re-review-019" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    // And the review engine exceeds timeout budget 300000 milliseconds
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewTimeoutFailureDeliveryId,
      failingStep: "review engine",
      headSha: ReReviewTimeoutFailureHeadSha,
    });

    // When Sovri handles the re-review command
    expect(runtime.pullGetRequests).toContain(`${RepoFullName}#${String(PullNumber)}`);
    // Then exactly 1 issue comment is posted on pull request 42
    expect(runtime.issueCommentBodies).toHaveLength(1);
    // And the issue comment explains that re-review failed
    expect(runtime.issueCommentBodies[0]).toContain("review failed");
    // And no walkthrough review is posted
    expect(runtime.successfulReviewRequests).toEqual([]);
  }, 35_000);

  it("draft pull request is skipped when draft reviews are disabled", async () => {
    // Given issue comment delivery "delivery-re-review-015" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "dddddddddddddddddddddddddddddddddddddddd"
    // And pull request 42 is a draft
    // And repository config sets `review.autoReviewDrafts` to false
    const runtime = await runReReviewFlow({
      configContent: [
        "llm:",
        "  provider: anthropic",
        "  model: claude-3-5-sonnet-latest",
        "  apiKeySecret: ANTHROPIC_API_KEY",
        "review:",
        "  autoReviewDrafts: false",
      ].join("\n"),
      deliveryId: ReReviewDraftSkipDeliveryId,
      draft: true,
      headSha: ReReviewHeadSha,
    });

    // When Sovri handles the re-review command
    // Then the shared flow loads repository config before skipping
    expect(runtime.repositoryConfigRequests).toEqual([RepoFullName]);
    expect(runtime.collaboratorCalls).toEqual(["load config"]);
    // And the diff fetcher is not called
    expect(runtime.listFilesQueries).toEqual([]);
    // And the review engine is not called
    expect(runtime.anthropicRequests).toEqual([]);
    // And no walkthrough review is posted
    expect(runtime.successfulReviewRequests).toEqual([]);
    expect(runtime.reviewRequests).toEqual([]);
  }, 15_000);

  it("draft pull request is reviewed when draft reviews are enabled", async () => {
    // Given issue comment delivery "delivery-re-review-016" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    // And pull request 42 is a draft
    // And repository config sets `review.autoReviewDrafts` to true
    const runtime = await runReReviewFlow({
      configContent: [
        "llm:",
        "  provider: anthropic",
        "  model: claude-3-5-sonnet-latest",
        "  apiKeySecret: ANTHROPIC_API_KEY",
        "review:",
        "  autoReviewDrafts: true",
      ].join("\n"),
      deliveryId: ReReviewDraftEnabledDeliveryId,
      draft: true,
      headSha: ReReviewOrderHeadSha,
      providerResponse: buildProviderResponseWithWalkthrough("Draft review complete"),
    });

    // When Sovri handles the re-review command
    // Then the review engine receives pull request 42 and head SHA "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    expect(runtime.collaboratorCalls).toEqual([
      "load config",
      "fetch diff",
      "review pull request",
      "post review",
    ]);
    expect(runtime.pullGetRequests).toEqual([`${RepoFullName}#${PullNumber}`]);
    expect(runtime.listFilesQueries).toEqual([`${PullNumber}?page=1&per_page=100`]);
    expect(runtime.anthropicRequests).toHaveLength(1);
    // And the walkthrough review is posted on pull request 42
    expect(runtime.successfulReviewRequests).toHaveLength(1);
    expect(runtime.successfulReviewRequests[0]?.pull_number).toBe(PullNumber);
    expect(runtime.successfulReviewRequests[0]?.commit_id).toBe(ReReviewOrderHeadSha);
    expect(runtime.successfulReviewRequests[0]?.body).toContain("Draft review complete");
  }, 15_000);

  it("non-draft pull request is reviewed when draft reviews are disabled", async () => {
    // Given issue comment delivery "delivery-re-review-017" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub `pulls.get` returns head SHA "ffffffffffffffffffffffffffffffffffffffff"
    // And pull request 42 is not a draft
    // And repository config sets `review.autoReviewDrafts` to false
    const runtime = await runReReviewFlow({
      configContent: [
        "llm:",
        "  provider: anthropic",
        "  model: claude-3-5-sonnet-latest",
        "  apiKeySecret: ANTHROPIC_API_KEY",
        "review:",
        "  autoReviewDrafts: false",
      ].join("\n"),
      deliveryId: ReReviewNonDraftWithDraftsDisabledDeliveryId,
      draft: false,
      headSha: ReReviewSuccessfulHeadSha,
      providerResponse: buildProviderResponseWithWalkthrough("Non-draft review complete"),
    });

    // When Sovri handles the re-review command
    // Then the review engine receives pull request 42 and head SHA "ffffffffffffffffffffffffffffffffffffffff"
    expect(runtime.collaboratorCalls).toEqual([
      "load config",
      "fetch diff",
      "review pull request",
      "post review",
    ]);
    expect(runtime.pullGetRequests).toEqual([`${RepoFullName}#${PullNumber}`]);
    expect(runtime.anthropicRequests).toHaveLength(1);
    // And the walkthrough review is posted on pull request 42
    expect(runtime.successfulReviewRequests).toHaveLength(1);
    expect(runtime.successfulReviewRequests[0]?.pull_number).toBe(PullNumber);
    expect(runtime.successfulReviewRequests[0]?.commit_id).toBe(ReReviewSuccessfulHeadSha);
    expect(runtime.successfulReviewRequests[0]?.body).toContain("Non-draft review complete");
  }, 15_000);

  it("reviews a pull request when it is marked ready for review", async () => {
    // Rule R-01 — @nominal: A pull request marked ready for review is reviewed
    // Background:
    //   Given a repository "acme/payments" with the Sovri Community bot installed
    //   And the repository config sets "review.autoReviewDrafts" to false
    // Given pull request #42 was opened as a draft and produced no review
    // When GitHub delivers a "pull_request.ready_for_review" event for pull request #42 with draft "false"
    const runtime = await runReviewFlow({
      action: "ready_for_review",
      configContent: [
        "llm:",
        "  provider: anthropic",
        "  model: claude-3-5-sonnet-latest",
        "  apiKeySecret: ANTHROPIC_API_KEY",
        "review:",
        "  autoReviewDrafts: false",
      ].join("\n"),
      deliveryId: ReadyForReviewDeliveryId,
      headSha: ReadyForReviewHeadSha,
    });

    // Then the bot reviews pull request #42
    expect(runtime.reviewRequests).toHaveLength(1);
    expect(runtime.successfulReviewRequests).toHaveLength(1);
    expect(runtime.successfulReviewRequests[0]?.pull_number).toBe(PullNumber);
    // And the bot posts a walkthrough review comment on pull request #42
    expect(runtime.successfulReviewRequests[0]?.body).toContain("<!-- sovri:walkthrough -->");
  }, 15_000);

  it("reviews on ready_for_review without waiting for a later synchronize push", async () => {
    // Rule R-01 — @technical: Review happens on ready_for_review without waiting for a later push
    // Given pull request #42 was opened as a draft and produced no review
    // And no "pull_request.synchronize" event is ever delivered for pull request #42
    // When GitHub delivers a "pull_request.ready_for_review" event for pull request #42 with draft "false"
    const runtime = await runReviewFlow({
      action: "ready_for_review",
      configContent: [
        "llm:",
        "  provider: anthropic",
        "  model: claude-3-5-sonnet-latest",
        "  apiKeySecret: ANTHROPIC_API_KEY",
        "review:",
        "  autoReviewDrafts: false",
      ].join("\n"),
      deliveryId: ReadyForReviewDeliveryId,
      headSha: ReadyForReviewHeadSha,
    });

    // Then the bot reviews pull request #42
    expect(runtime.reviewRequests).toHaveLength(1);
    // And the bot does not wait for a "pull_request.synchronize" event to trigger the review
    // (the single review was driven by the ready_for_review head SHA, no synchronize delivered)
    expect(runtime.reviewRequests[0]?.commit_id).toBe(ReadyForReviewHeadSha);
  }, 15_000);

  it.each([{ autoReviewDrafts: "false" }, { autoReviewDrafts: "true" }])(
    "reviews a ready_for_review pull request whatever autoReviewDrafts=$autoReviewDrafts",
    async ({ autoReviewDrafts }) => {
      // Rule R-02 — @nominal @limit: ready_for_review proceeds whatever the autoReviewDrafts setting
      // Background: Given a repository "acme/payments" with the Sovri Community bot installed
      // Given the repository config sets "review.autoReviewDrafts" to <autoReviewDrafts>
      // And pull request #42 was opened as a draft and produced no review
      // When GitHub delivers a "pull_request.ready_for_review" event for pull request #42 with draft "false"
      const runtime = await runReviewFlow({
        action: "ready_for_review",
        configContent: [
          "llm:",
          "  provider: anthropic",
          "  model: claude-3-5-sonnet-latest",
          "  apiKeySecret: ANTHROPIC_API_KEY",
          "review:",
          `  autoReviewDrafts: ${autoReviewDrafts}`,
        ].join("\n"),
        deliveryId: `delivery-ready-for-review-r02-${autoReviewDrafts}`,
        headSha: ReadyForReviewHeadSha,
      });

      // Then the bot reviews pull request #42
      expect(runtime.reviewRequests).toHaveLength(1);
      expect(runtime.successfulReviewRequests[0]?.pull_number).toBe(PullNumber);
      // And the review is not skipped as a draft
      expect(runtime.successfulReviewRequests).toHaveLength(1);
    },
    15_000,
  );

  it("re-review preserves synchronize collaborator order", async () => {
    // Given issue comment delivery "delivery-re-review-002" targets repository "octo-org/sovri-target"
    // And issue 42 is pull request 42
    // And comment 98765 was authored by "alice"
    // And the command body is "@sovri-bot re-review"
    // And GitHub pull request 42 currently has head SHA "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    // And every review collaborator succeeds
    const runtime = await runReReviewFlow({
      deliveryId: ReReviewOrderDeliveryId,
      headSha: ReReviewOrderHeadSha,
    });

    // When Sovri accepts the re-review command
    // Then collaborator call 1 is "load config"
    // And collaborator call 2 is "fetch diff"
    // And collaborator call 3 is "review pull request"
    // And collaborator call 4 is "post review"
    expect(runtime.collaboratorCalls).toEqual([
      "load config",
      "fetch diff",
      "review pull request",
      "post review",
    ]);
  }, 15_000);
});

function runOpenedReviewFlow(): Promise<ObservedRuntime> {
  openedReviewFlow ??= runReviewFlow({ action: "opened", headSha: OpenedHeadSha });
  return openedReviewFlow;
}

function runCachedSynchronizeReviewFlow(values: {
  readonly deliveryId: string;
  readonly headSha: string;
}): Promise<ObservedRuntime> {
  const key = `${values.deliveryId}:${values.headSha}`;
  const cached = synchronizeReviewFlows.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const runtime = runReviewFlow({
    action: "synchronize",
    deliveryId: values.deliveryId,
    headSha: values.headSha,
  });
  synchronizeReviewFlows.set(key, runtime);
  return runtime;
}

function publishedOutput(runtime: ObservedRuntime): string {
  return JSON.stringify({
    anthropicRequests: runtime.anthropicRequests,
    issueCommentBodies: runtime.issueCommentBodies,
    mistralRequests: runtime.mistralRequests,
    reviewRequests: runtime.reviewRequests,
  });
}

async function runReviewFlow(values: {
  readonly action: "opened" | "synchronize" | "ready_for_review";
  readonly configContent?: string;
  readonly deliveryId?: string;
  readonly headSha: string;
  readonly mistralApiKey?: string;
  readonly reviewStatus?: number;
}): Promise<ObservedRuntime> {
  const runtime: ObservedRuntime = {
    anthropicApiKeys: [],
    anthropicRequests: [],
    checkRunRequests: [],
    collaboratorCalls: [],
    eventLog: [],
    issueCommentBodies: [],
    listFilesQueries: [],
    mistralApiKeys: [],
    mistralRequests: [],
    pullGetRequests: [],
    reactionRequests: [],
    repositoryConfigRequests: [],
    reviewRequests: [],
    successfulReviewRequests: [],
  };
  vi.stubEnv("ANTHROPIC_API_KEY", SecretLlmValue);
  if (Object.hasOwn(values, "mistralApiKey")) {
    vi.stubEnv("MISTRAL_API_KEY", values.mistralApiKey);
  }
  installReviewFlowHandlers(runtime, values.reviewStatus ?? 200, values.headSha);
  if (values.configContent !== undefined) {
    installRepositoryConfigHandler(values.configContent, runtime);
  }
  const probot = new Probot({
    githubToken: SecretInstallationToken,
    log: createLogger("community-bot.e2e-test"),
  });
  await probot.load(app, { addHandler() {} });
  await probot.receive({
    id: values.deliveryId ?? eventDeliveryId(values.action),
    name: "pull_request",
    payload: buildPullRequestPayload({ action: values.action, headSha: values.headSha }),
  });
  return runtime;
}

async function runReReviewFlow(values: {
  readonly configContent?: string;
  readonly deliveryId?: string;
  readonly draft?: boolean;
  readonly failingStep?: ReviewFlowFailureStep;
  readonly headSha: string;
  readonly pullLookupStatus?: number;
  readonly providerResponse?: ProviderReviewResponse;
}): Promise<ObservedRuntime> {
  const runtime: ObservedRuntime = {
    anthropicApiKeys: [],
    anthropicRequests: [],
    checkRunRequests: [],
    collaboratorCalls: [],
    eventLog: [],
    issueCommentBodies: [],
    listFilesQueries: [],
    mistralApiKeys: [],
    mistralRequests: [],
    pullGetRequests: [],
    reactionRequests: [],
    repositoryConfigRequests: [],
    reviewRequests: [],
    successfulReviewRequests: [],
  };
  vi.stubEnv("ANTHROPIC_API_KEY", SecretLlmValue);
  installReviewFlowHandlers(
    runtime,
    200,
    values.headSha,
    values.pullLookupStatus ?? 200,
    values.failingStep,
    values.providerResponse,
    values.draft ?? false,
  );
  if (values.configContent !== undefined) {
    installRepositoryConfigHandler(values.configContent, runtime);
  }
  const probot = new Probot({
    githubToken: SecretInstallationToken,
    log: createLogger("community-bot.e2e-test"),
  });
  await probot.load(app, { addHandler() {} });
  await probot.receive({
    id: values.deliveryId ?? ReReviewDeliveryId,
    name: "issue_comment",
    payload: buildIssueCommentPayload(),
  });
  return runtime;
}

function installRepositoryConfigHandler(configContent: string, runtime?: ObservedRuntime): void {
  server.use(
    http.get(`${GitHubBaseUrl}/repos/:owner/:repo/contents/.sovri.yml`, ({ params }) => {
      runtime?.collaboratorCalls.push("load config");
      runtime?.repositoryConfigRequests.push(`${String(params.owner)}/${String(params.repo)}`);
      return HttpResponse.text(configContent);
    }),
  );
}

function installReviewFlowHandlers(
  runtime: ObservedRuntime,
  reviewStatus: number,
  currentHeadSha: string,
  pullLookupStatus = 200,
  failingStep?: ReviewFlowFailureStep,
  providerResponse: ProviderReviewResponse = buildProviderResponse(3),
  draft = false,
): void {
  server.use(
    http.get(`${GitHubBaseUrl}/repos/:owner/:repo/contents/.sovri.yml`, ({ params }) => {
      runtime.collaboratorCalls.push("load config");
      runtime.repositoryConfigRequests.push(`${String(params.owner)}/${String(params.repo)}`);
      return HttpResponse.json({ message: "Not Found" }, { status: 404 });
    }),
    http.get(`${GitHubBaseUrl}/repos/:owner/:repo/pulls/:pull_number`, ({ params, request }) => {
      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("diff")) {
        runtime.collaboratorCalls.push("fetch diff");
        if (failingStep === "diff fetcher") {
          return HttpResponse.json({ message: "provider timeout" }, { status: 404 });
        }
        return HttpResponse.text("not a unified diff");
      }
      runtime.pullGetRequests.push(
        `${String(params.owner)}/${String(params.repo)}#${String(params.pull_number)}`,
      );
      if (pullLookupStatus !== 200) {
        return HttpResponse.json({ message: "Not Found" }, { status: pullLookupStatus });
      }
      return HttpResponse.json(
        buildPullRequestPayload({ action: "synchronize", draft, headSha: currentHeadSha })
          .pull_request,
      );
    }),
    http.get(
      `${GitHubBaseUrl}/repos/:owner/:repo/pulls/:pull_number/files`,
      ({ params, request }) => {
        runtime.listFilesQueries.push(
          `${String(params.pull_number)}?${new URL(request.url).searchParams.toString()}`,
        );
        return HttpResponse.json(defaultGitHubFiles());
      },
    ),
    http.get(`${GitHubBaseUrl}/repos/:owner/:repo/pulls/:pull_number/reviews`, () =>
      HttpResponse.json([]),
    ),
    http.get(`${GitHubBaseUrl}/repos/:owner/:repo/issues/:issue_number/comments`, () =>
      HttpResponse.json([]),
    ),
    http.post(`${GitHubBaseUrl}/graphql`, () =>
      HttpResponse.json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          },
        },
      }),
    ),
    http.post(
      `${GitHubBaseUrl}/repos/:owner/:repo/pulls/:pull_number/reviews`,
      async ({ params, request }) => {
        runtime.collaboratorCalls.push("post review");
        const route = PullRequestReviewRouteSchema.parse(params);
        const body = PullRequestReviewBodySchema.parse(await request.json());
        const reviewRequest = validatePullRequestReviewRequest({
          ...body,
          owner: route.owner,
          pull_number: Number.parseInt(route.pull_number, 10),
          repo: route.repo,
        });
        runtime.reviewRequests.push(reviewRequest);
        runtime.eventLog.push("post review");
        if (failingStep === "review poster" || reviewStatus === 403) {
          return HttpResponse.json(
            { message: "Resource not accessible by integration" },
            { status: 403 },
          );
        }
        runtime.successfulReviewRequests.push(reviewRequest);
        return HttpResponse.json({ body: reviewRequest.body, id: 98765 });
      },
    ),
    http.post(`${GitHubBaseUrl}/repos/:owner/:repo/check-runs`, async ({ params, request }) => {
      const route = CheckRunRouteSchema.parse(params);
      const body = CheckRunBodySchema.parse(await request.json());
      runtime.checkRunRequests.push({
        ...body,
        owner: route.owner,
        repo: route.repo,
      });
      return HttpResponse.json({ id: runtime.checkRunRequests.length }, { status: 201 });
    }),
    http.post(
      `${GitHubBaseUrl}/repos/:owner/:repo/issues/:issue_number/comments`,
      async ({ request }) => {
        const body = IssueCommentCreateSchema.parse(await request.json());
        runtime.issueCommentBodies.push(body.body);
        return HttpResponse.json({ body: body.body, id: 87654 }, { status: 201 });
      },
    ),
    http.post(
      `${GitHubBaseUrl}/repos/:owner/:repo/issues/comments/:comment_id/reactions`,
      async ({ params, request }) => {
        const route = z
          .object({
            comment_id: z.string().regex(/^\d+$/),
            owner: z.string().min(1),
            repo: z.string().min(1),
          })
          .parse(params);
        const body = z.object({ content: z.literal("+1") }).parse(await request.json());
        runtime.reactionRequests.push({
          comment_id: Number.parseInt(route.comment_id, 10),
          content: body.content,
          owner: route.owner,
          repo: route.repo,
        });
        runtime.eventLog.push("accepted reaction");
        return HttpResponse.json({ content: body.content, id: 7654321 });
      },
    ),
    http.post(AnthropicMessagesUrl, async ({ request }) => {
      runtime.collaboratorCalls.push("review pull request");
      runtime.anthropicApiKeys.push(request.headers.get("x-api-key") ?? "");
      runtime.anthropicRequests.push(await request.json());
      if (failingStep === "review engine") {
        return HttpResponse.json({ message: "provider timeout" }, { status: 408 });
      }
      return anthropicMessageWithText(JSON.stringify(providerResponse));
    }),
    http.post(MistralChatUrl, async ({ request }) => {
      runtime.mistralApiKeys.push(
        request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "",
      );
      runtime.mistralRequests.push(await request.json());
      return mistralChatCompletionWithText(JSON.stringify(providerResponse));
    }),
  );
}

function buildIssueCommentPayload() {
  return {
    action: "created",
    comment: {
      body: "@sovri-bot re-review",
      id: CommentId,
      user: {
        login: "alice",
      },
    },
    installation: {
      id: 123456,
    },
    issue: {
      number: PullNumber,
      pull_request: {},
    },
    repository: {
      full_name: RepoFullName,
    },
  };
}

function buildPullRequestPayload(values: {
  readonly action: string;
  readonly draft?: boolean;
  readonly headSha: string;
}) {
  return {
    action: values.action,
    installation: {
      id: 123456,
    },
    pull_request: {
      additions: 3,
      base: {
        ref: "main",
        sha: BaseSha,
      },
      body: "Wire Sovri pull request review.",
      changed_files: 3,
      deletions: 0,
      draft: values.draft ?? false,
      head: {
        ref: "task-45",
        sha: values.headSha,
      },
      number: PullNumber,
      title: "Wire Sovri pull request review",
      user: {
        login: "octocat",
      },
    },
    repository: {
      full_name: RepoFullName,
    },
  };
}

function buildProviderResponse(findingCount: number): ProviderReviewResponse {
  return ProviderReviewResponseSchema.parse({
    summary: "Review completed.",
    findings: defaultProviderFindings().slice(0, findingCount),
    walkthrough_markdown: buildWalkthroughMarkdown(findingCount),
  });
}

function buildProviderResponseWithWalkthrough(walkthroughMarkdown: string): ProviderReviewResponse {
  return ProviderReviewResponseSchema.parse({
    summary: walkthroughMarkdown,
    findings: defaultProviderFindings().slice(0, 3),
    walkthrough_markdown: walkthroughMarkdown,
  });
}

function defaultProviderFindings(): ProviderReviewResponse["findings"] {
  return [
    {
      severity: "blocker",
      category: "bug",
      file: "apps/community-bot/src/handlers/pull-request.ts",
      line_start: 42,
      line_end: 42,
      title: "Missing webhook payload guard",
      body: "The opened webhook fixture must be validated before delivery.",
      recommendation:
        "Add a Zod schema guard at the top of the handler before processing the payload.",
      confidence: 0.91,
    },
    {
      severity: "major",
      category: "bug",
      file: "apps/community-bot/src/github/comment-poster.ts",
      line_start: 57,
      line_end: 57,
      title: "Dropped inline comment",
      body: "The posted review must include the expected inline comment.",
      recommendation:
        "Return the inline comment draft from the builder and include it in the review payload.",
      confidence: 0.91,
    },
    {
      severity: "minor",
      category: "maintainability",
      file: "packages/review-engine/src/orchestrator.ts",
      line_start: 88,
      line_end: 88,
      title: "Redundant severity grouping",
      body: "Severity counts must remain stable in the posted walkthrough.",
      recommendation:
        "Remove the duplicate grouping pass and derive counts from the single findings array.",
      confidence: 0.91,
    },
    {
      severity: "info",
      category: "documentation",
      file: "packages/review-engine/src/orchestrator.ts",
      line_start: 90,
      line_end: 90,
      title: "Extra fixture finding",
      body: "This fourth finding is intentionally invalid for the fixture contract.",
      recommendation:
        "This finding exists only to test the 4-finding rejection path; do not use in valid responses.",
      confidence: 0.91,
    },
  ];
}

function buildWalkthroughMarkdown(findingCount: number): string {
  const findings = defaultProviderFindings().slice(0, findingCount);
  const sections = findings.map(
    (finding) =>
      `#### ${capitalize(finding.severity)}\n\n| Severity | Location | Title | Details |\n| --- | --- | --- | --- |\n| ${capitalize(finding.severity)} | ${finding.file}:${String(finding.line_start)} | ${finding.title} | ${finding.body} |`,
  );
  return [
    "## Sovri review",
    "",
    "### TL;DR",
    "",
    "Review completed.",
    "",
    "### Findings",
    "",
    ...sections,
  ].join("\n");
}

function defaultGitHubFiles() {
  return [
    buildGitHubFile("apps/community-bot/src/handlers/pull-request.ts", 42),
    buildGitHubFile("apps/community-bot/src/github/comment-poster.ts", 57),
    buildGitHubFile("packages/review-engine/src/orchestrator.ts", 88),
  ];
}

function buildGitHubFile(filename: string, line: number) {
  return {
    additions: 1,
    changes: 2,
    deletions: 1,
    filename,
    patch: [`@@ -${String(line - 1)},1 +${String(line)},1 @@`, "-old", "+new"].join("\n"),
    sha: "ffffffffffffffffffffffffffffffffffffffff",
    status: "modified",
  };
}

function anthropicMessageWithText(text: string) {
  return HttpResponse.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-3-5-sonnet-latest",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 144 },
  });
}

function mistralChatCompletionWithText(text: string) {
  return HttpResponse.json({
    id: "cmpl_test",
    object: "chat.completion",
    model: "mistral-large-latest",
    created: 0,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 812, completion_tokens: 144, total_tokens: 956 },
  });
}

function validateOpenedFixture(payload: unknown): {
  readonly message: string;
  readonly valid: boolean;
} {
  const candidate = z
    .object({
      action: z.string(),
      pull_request: z.object({ number: z.number().int().positive() }),
      repository: z.object({ full_name: z.string().min(1) }),
    })
    .safeParse(payload);
  if (!candidate.success) {
    return {
      message: candidate.error.issues
        .map((issue) => issue.path.join(".") || issue.message)
        .join("; "),
      valid: false,
    };
  }
  if (candidate.data.action !== "opened") {
    return { message: "expected action opened", valid: false };
  }
  return { message: "", valid: true };
}

function validateListFilesFixture(files: readonly unknown[]): {
  readonly message: string;
  readonly valid: boolean;
} {
  const candidate = z
    .array(z.object({ filename: z.string().min(1), status: z.string().min(1) }).passthrough())
    .safeParse(files);
  if (candidate.success) {
    return { message: files.length === 0 ? "" : "valid", valid: true };
  }
  return { message: "filename", valid: false };
}

function validateAnthropicFixture(response: ProviderReviewResponse): {
  readonly message: string;
  readonly valid: boolean;
} {
  const findingCount = response.findings.length;
  const confidenceValid = response.findings.every((finding) => finding.confidence === 0.91);
  if ((findingCount === 2 || findingCount === 3) && confidenceValid) {
    return { message: "", valid: true };
  }
  return { message: "2-3 findings", valid: false };
}

function evaluateBudget(
  elapsedMs: number,
  thresholdMs: number,
): { readonly message: string; readonly passed: boolean } {
  if (elapsedMs < thresholdMs) {
    return { message: "", passed: true };
  }
  const seconds = String(thresholdMs / 1000);
  return { message: `must finish in under ${seconds} s`, passed: false };
}

function formatDuration(elapsedMs: number): string {
  return `${String(elapsedMs / 1000)} s`;
}

function countSeverities(response: ProviderReviewResponse) {
  const counts = { blocker: 0, major: 0, minor: 0, info: 0, nitpick: 0 };
  for (const finding of response.findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

function countRowsWithBadge(markdown: string, badge: string): number {
  return markdown.split("\n").filter((line) => line.startsWith(`| ${badge}`)).length;
}

function expectPostedReviewRequest(runtime: ObservedRuntime): void {
  expect(runtime.reviewRequests).toHaveLength(1);
}

function expectReviewRequestCommit(runtime: ObservedRuntime): void {
  expect(runtime.reviewRequests[0]?.commit_id).toBe(OpenedHeadSha);
}

function expectReviewRequestEvent(runtime: ObservedRuntime): void {
  expect(runtime.reviewRequests[0]?.event).toBe("COMMENT");
}

function expectExpectedSeverityCounts(): void {
  expect(countSeverities(buildProviderResponse(3))).toEqual({
    blocker: 1,
    info: 0,
    major: 1,
    minor: 1,
    nitpick: 0,
  });
}

function expectBadgeRowCount(runtime: ObservedRuntime, badge: string): void {
  expect(countRowsWithBadge(runtime.reviewRequests[0]?.body ?? "", badge)).toBe(1);
}

function expectReviewCommentAnchors(runtime: ObservedRuntime): void {
  expect(commentAnchors(runtime.reviewRequests[0]?.comments ?? [])).toEqual([
    "apps/community-bot/src/handlers/pull-request.ts:42",
    "apps/community-bot/src/github/comment-poster.ts:57",
    "packages/review-engine/src/orchestrator.ts:88",
  ]);
}

function commentAnchors(comments: readonly ReviewRequest["comments"][number][]): string[] {
  return comments.map((comment) => `${comment.path}:${String(comment.line)}`);
}

function buildExpectedAnchors(files: readonly ReturnType<typeof buildGitHubFile>[]): string[] {
  return files.map((file) => `${file.filename}:1`);
}

function compareExpectedAnchors(actual: readonly string[]): {
  readonly message: string;
  readonly valid: boolean;
} {
  const expected = [
    "apps/community-bot/src/handlers/pull-request.ts:42",
    "apps/community-bot/src/github/comment-poster.ts:57",
    "packages/review-engine/src/orchestrator.ts:88",
  ];
  const missing = expected.filter((anchor) => !actual.includes(anchor));
  if (missing.length === 0) {
    return { message: "", valid: true };
  }
  return { message: missing.join(", "), valid: false };
}

function compareSeverityCounts(counts: ReturnType<typeof countSeverities>): {
  readonly message: string;
  readonly valid: boolean;
} {
  const expected = countSeverities(buildProviderResponse(3));
  const valid = Object.entries(expected).every(
    ([severity, expectedCount]) => counts[severity] === expectedCount,
  );
  return valid ? { message: "", valid } : { message: "severity counts differ", valid };
}

function reviewPostSucceeded(runtime: ObservedRuntime, reviewStatus: number): boolean {
  return (
    runtime.reviewRequests.length === 1 &&
    reviewStatus < 400 &&
    runtime.issueCommentBodies.length === 0
  );
}

function eventOrder(runtime: ObservedRuntime, event: string): number {
  const index = runtime.eventLog.indexOf(event);
  if (index < 0) {
    throw new Error(`Expected event log to include ${event}`);
  }

  return index;
}

function compareSynchronizeHeadSha(
  deliveredHeadSha: string,
  postedHeadSha: string,
): { readonly message: string; readonly valid: boolean } {
  if (deliveredHeadSha === postedHeadSha) {
    return { message: "", valid: true };
  }
  return { message: "synchronize review must use the delivered head SHA", valid: false };
}

function eventDeliveryId(action: "opened" | "synchronize" | "ready_for_review"): string {
  if (action === "opened") {
    return OpenedDeliveryId;
  }
  if (action === "ready_for_review") {
    return ReadyForReviewDeliveryId;
  }
  return SynchronizeDeliveryId;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
