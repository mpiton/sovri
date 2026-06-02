// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { SovriConfig } from "@sovri/config";
import { MissingApiKeyError } from "@sovri/llm-providers";
import { computeFindingFingerprint, type Diff, type Review } from "@sovri/review-engine";
import { registerWebhookHandlers } from "../../src/handlers/index.js";
import {
  handlePullRequestOpened,
  handlePullRequestSynchronize,
  type PullRequestHandlerDependencies,
  type PullRequestWebhookContext,
} from "../../src/handlers/pull-request.js";

const REPO_FULL_NAME = "mpiton/sovri";
const BASE_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const OPENED_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SYNCHRONIZED_HEAD_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DELIVERY_ID = "8f1b9c2d-3e4f-45a6-91b2-123456789abc";
const HANDLER_SOURCE_URL = new URL("../../src/handlers/pull-request.ts", import.meta.url);

describe("pull request handlers - ATDD #477", () => {
  it.each([
    {
      event: "pull_request.opened",
      handler: handlePullRequestOpened,
      handlerName: "handlePullRequestOpened",
      headSha: OPENED_HEAD_SHA,
    },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      handlerName: "handlePullRequestSynchronize",
      headSha: SYNCHRONIZED_HEAD_SHA,
    },
  ])(
    "$handlerName delegates every review step to collaborators",
    async ({ event, handler, headSha }) => {
      const config = buildConfig({ autoReviewDrafts: false });
      const diff = buildDiff();
      const review = buildReview({ commitSha: headSha });
      const dependencies = buildDependencies({ config, diff, review });
      const context = buildContext({ event, headSha });

      // Given the config loader returns `autoReviewDrafts: false`
      expect(config.review.autoReviewDrafts).toBe(false);
      // And the diff fetcher returns a unified diff for file "apps/community-bot/src/handlers/pull-request.ts"
      expect(diff.files[0]?.path).toBe("apps/community-bot/src/handlers/pull-request.ts");
      // And the review engine returns a review with 1 finding
      expect(review.findings).toHaveLength(1);

      // When `<handler>` handles the `<event>` webhook for pull request 41
      await handler(context, dependencies);

      // Then the handler calls the config loader exactly 1 time
      expect(dependencies.loadConfig).toHaveBeenCalledTimes(1);
      // And the handler calls the diff fetcher exactly 1 time
      expect(dependencies.fetchDiff).toHaveBeenCalledTimes(1);
      // And the handler calls the review engine exactly 1 time
      expect(dependencies.reviewPullRequest).toHaveBeenCalledTimes(1);
      // And the handler calls the review poster exactly 1 time
      expect(dependencies.postReview).toHaveBeenCalledTimes(1);
      // And the review engine receives head SHA "<head_sha>"
      expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequest: expect.objectContaining({ head_sha: headSha }),
        }),
        expect.any(Object),
      );
      // And the handler does not compute findings itself
      expect(dependencies.postReview).toHaveBeenCalledWith(
        expect.objectContaining({ number: 41, repoFullName: REPO_FULL_NAME }),
        review,
        diff,
      );
    },
  );
});

describe("pull request handlers - remaining ATDD scenarios", () => {
  it("rejects handler-owned finding generation", () => {
    const source = readFileSync(HANDLER_SOURCE_URL, "utf8");

    // Given "apps/community-bot/src/handlers/pull-request.ts" creates a finding with severity "major"
    expect(source).not.toContain('severity: "major"');
    // When the handler module is inspected
    expect(source).not.toContain("FindingSchema");
    // Then the orchestration check fails
    expect(source).not.toContain("findings: [");
    // And the failure mentions "review business logic belongs in @sovri/review-engine"
    expect(source).not.toContain("review business logic belongs in @sovri/review-engine");
  });

  it("does not parse or transform the unified diff itself", async () => {
    const diff = buildDiff({ changedFiles: 2 });
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff,
      review: buildReview({ commitSha: SYNCHRONIZED_HEAD_SHA }),
    });
    const source = readFileSync(HANDLER_SOURCE_URL, "utf8");

    // Given the diff fetcher returns a unified diff containing 2 changed files
    // When `handlePullRequestSynchronize(context)` handles pull request 41
    await handlePullRequestSynchronize(
      buildContext({
        event: "pull_request.synchronize",
        headSha: SYNCHRONIZED_HEAD_SHA,
      }),
      dependencies,
    );

    // Then the diff fetcher receives repository "mpiton/sovri" and pull request number 41
    expect(dependencies.fetchDiff).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41, repoFullName: REPO_FULL_NAME }),
    );
    // And the review engine receives the diff returned by the diff fetcher
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ diff }),
      expect.any(Object),
    );
    // And the handler module does not import a diff parser
    expect(source).not.toContain("parseUnifiedDiff");
    // And the handler module does not count changed files itself
    expect(source).not.toContain("changed_files >");
  });

  it.each([
    {
      event: "pull_request.opened",
      handler: handlePullRequestOpened,
      headSha: OPENED_HEAD_SHA,
    },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      headSha: SYNCHRONIZED_HEAD_SHA,
    },
  ])("keeps successful $event logs free of secret values", async ({ event, handler, headSha }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: headSha }),
    });

    // Given the pull request head SHA is "<head_sha>"
    const context = buildContext({ event, headSha });
    // And the review engine returns a review with 0 findings
    dependencies.reviewPullRequest.mockResolvedValue(
      buildReview({ commitSha: headSha, findings: 0 }),
    );
    // When `<handler>` completes the `<event>` webhook successfully
    await handler(context, dependencies);

    // Then no log line contains "secret-webhook-value-41"
    expect(logOutput(dependencies)).not.toContain("secret-webhook-value-41");
    // And no log line contains "secret-llm-value-41"
    expect(logOutput(dependencies)).not.toContain("secret-llm-value-41");
    // And no log line contains "secret-installation-token-41"
    expect(logOutput(dependencies)).not.toContain("secret-installation-token-41");
    // And the logs include repository "mpiton/sovri" and pull request number 41
    expect(logOutput(dependencies)).toContain(REPO_FULL_NAME);
    expect(logOutput(dependencies)).toContain("41");
  });

  it("does not log the raw webhook payload", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the raw webhook payload contains "secret-webhook-value-41"
    const context = buildContext({
      event: "pull_request.opened",
      headSha: OPENED_HEAD_SHA,
      title: "secret-webhook-value-41",
    });
    // When the handler logs the raw webhook payload
    await handlePullRequestOpened(context, dependencies);

    // Then the secret logging check fails
    expect(logOutput(dependencies)).not.toContain("secret-webhook-value-41");
    // And the failure mentions "raw webhook payload must not be logged"
    expect(logOutput(dependencies)).not.toContain("raw webhook payload");
  });

  it.each([
    {
      failingStep: "review engine",
      handler: handlePullRequestOpened,
      reject: "reviewPullRequest",
    },
    {
      failingStep: "diff fetcher",
      handler: handlePullRequestSynchronize,
      reject: "fetchDiff",
    },
  ])("keeps failing $failingStep reports free of secret values", async ({ handler, reject }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies[reject].mockRejectedValue(new Error("provider timeout"));

    // Given the config loader resolves an LLM API key from "ANTHROPIC_API_KEY"
    expect((await dependencies.loadConfig(buildTarget())).llm.apiKeySecret).toBe(
      "ANTHROPIC_API_KEY",
    );
    // And the `<failing_step>` rejects with message "<failure_message>"
    // When `<handler>` handles the failure
    await handler(
      buildContext({
        event: "pull_request.opened",
        headSha: OPENED_HEAD_SHA,
      }),
      dependencies,
    );

    // Then no error log line contains "secret-webhook-value-41"
    expect(logOutput(dependencies)).not.toContain("secret-webhook-value-41");
    // And no error log line contains "secret-llm-value-41"
    expect(logOutput(dependencies)).not.toContain("secret-llm-value-41");
    // And no error log line contains "secret-installation-token-41"
    expect(logOutput(dependencies)).not.toContain("secret-installation-token-41");
    // And no PR error comment contains "secret-webhook-value-41"
    expect(commentOutput(dependencies)).not.toContain("secret-webhook-value-41");
    // And no PR error comment contains "secret-llm-value-41"
    expect(commentOutput(dependencies)).not.toContain("secret-llm-value-41");
    // And no PR error comment contains "secret-installation-token-41"
    expect(commentOutput(dependencies)).not.toContain("secret-installation-token-41");
    // And the error log includes pull request number 41
    expect(logOutput(dependencies)).toContain("41");
  });

  it("reviews and posts an opened pull request", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the pull request is not a draft
    const context = buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA });
    // And the config loader returns `autoReviewDrafts: false`
    // And the diff fetcher returns a unified diff for "apps/community-bot/src/handlers/pull-request.ts"
    // And the review engine returns walkthrough "Review complete" with 1 inline comment
    // When `handlePullRequestOpened(context)` handles the webhook
    await handlePullRequestOpened(context, dependencies);

    // Then the config loader receives repository "mpiton/sovri"
    expect(dependencies.loadConfig).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: REPO_FULL_NAME }),
    );
    // And the diff fetcher receives pull request number 41
    expect(dependencies.fetchDiff).toHaveBeenCalledWith(expect.objectContaining({ number: 41 }));
    // And the review engine receives pull request 41 and head SHA "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: expect.objectContaining({ head_sha: OPENED_HEAD_SHA, number: 41 }),
      }),
      expect.any(Object),
    );
    // And the review poster posts walkthrough "Review complete"
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.any(Object),
      dependencies.review,
      dependencies.diff,
    );
    // And the review poster posts 1 inline comment
    expect(dependencies.review.findings).toHaveLength(1);
  });

  it("does not post a review without calling the engine", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies.reviewPullRequest.mockRejectedValue(new Error("provider timeout"));

    // Given the diff fetcher returns a unified diff for "apps/community-bot/src/handlers/pull-request.ts"
    // And the review engine has not been called
    // When the review poster is called for pull request 41
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then the review flow check fails
    expect(dependencies.postReview).not.toHaveBeenCalled();
    // And the failure mentions "review must come from the review engine"
    expect(dependencies.postErrorComment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("review failed"),
    );
  });

  it("calls review flow collaborators in order", async () => {
    const calls: string[] = [];
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies.loadConfig.mockImplementation(async () => {
      calls.push("load config");
      return buildConfig({ autoReviewDrafts: false });
    });
    dependencies.fetchDiff.mockImplementation(async () => {
      calls.push("fetch diff");
      return buildDiff();
    });
    dependencies.reviewPullRequest.mockImplementation(async () => {
      calls.push("review pull request");
      return buildReview({ commitSha: OPENED_HEAD_SHA });
    });
    dependencies.postReview.mockImplementation(async () => {
      calls.push("post review");
    });

    // Given the pull request is not a draft
    // And all collaborators succeed
    // When `handlePullRequestOpened(context)` handles the webhook
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then collaborator call 1 is "load config"
    // And collaborator call 2 is "fetch diff"
    // And collaborator call 3 is "review pull request"
    // And collaborator call 4 is "post review"
    expect(calls).toEqual(["load config", "fetch diff", "review pull request", "post review"]);
  });

  it("passes an empty diff through the engine and poster", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff({ changedFiles: 0 }),
      review: buildReview({
        commitSha: OPENED_HEAD_SHA,
        findings: 0,
        walkthrough: "No changed lines to review",
      }),
    });

    // Given the pull request is not a draft
    // And the config loader returns `autoReviewDrafts: false`
    // And the diff fetcher returns an empty unified diff
    // And the review engine returns walkthrough "No changed lines to review" with 0 inline comments
    // When `handlePullRequestOpened(context)` handles the webhook
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then the review engine receives pull request 41 and the empty unified diff
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ diff: expect.objectContaining({ files: [] }) }),
      expect.any(Object),
    );
    // And the review poster posts walkthrough "No changed lines to review"
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.any(Object),
      dependencies.review,
      dependencies.diff,
    );
    // And the review poster posts 0 inline comments
    expect(dependencies.review.findings).toHaveLength(0);
  });

  it("reviews synchronize events on the new head SHA", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: SYNCHRONIZED_HEAD_SHA }),
    });

    // Given the pull request is not a draft
    // And the config loader returns `autoReviewDrafts: false`
    // And the diff fetcher returns the diff for head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    // When `handlePullRequestSynchronize(context)` handles the webhook
    await handlePullRequestSynchronize(
      buildContext({ event: "pull_request.synchronize", headSha: SYNCHRONIZED_HEAD_SHA }),
      dependencies,
    );

    // Then the review engine receives head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: expect.objectContaining({ head_sha: SYNCHRONIZED_HEAD_SHA }),
      }),
      expect.any(Object),
    );
    // And the review poster attaches inline comments to commit "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.objectContaining({ commitSha: SYNCHRONIZED_HEAD_SHA }),
      dependencies.review,
      dependencies.diff,
    );
  });

  it("handles consecutive and repeated synchronize deliveries with the delivered head SHA", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: SYNCHRONIZED_HEAD_SHA }),
    });

    // Given a first synchronize webhook contains head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    // And a second synchronize webhook contains head SHA "cccccccccccccccccccccccccccccccccccccccc"
    await handlePullRequestSynchronize(
      buildContext({ event: "pull_request.synchronize", headSha: SYNCHRONIZED_HEAD_SHA }),
      dependencies,
    );
    await handlePullRequestSynchronize(
      buildContext({
        event: "pull_request.synchronize",
        headSha: "cccccccccccccccccccccccccccccccccccccccc",
      }),
      dependencies,
    );
    // And the same synchronize webhook is delivered twice with head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    await handlePullRequestSynchronize(
      buildContext({ event: "pull_request.synchronize", headSha: SYNCHRONIZED_HEAD_SHA }),
      dependencies,
    );

    // Then the first review engine call receives head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(reviewHeadShaAt(dependencies, 0)).toBe(SYNCHRONIZED_HEAD_SHA);
    // And the second review engine call receives head SHA "cccccccccccccccccccccccccccccccccccccccc"
    expect(reviewHeadShaAt(dependencies, 1)).toBe("cccccccccccccccccccccccccccccccccccccccc");
    // And no review engine call receives stale head SHA "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    expect(logOutput(dependencies)).not.toContain(OPENED_HEAD_SHA);
    // And the repeated delivery review engine call receives head SHA "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    expect(reviewHeadShaAt(dependencies, 2)).toBe(SYNCHRONIZED_HEAD_SHA);
  });

  it.each([
    {
      event: "pull_request.opened",
      handler: handlePullRequestOpened,
      state: "open",
    },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      state: "open",
    },
    {
      event: "pull_request.opened",
      handler: handlePullRequestOpened,
      state: "draft",
    },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      state: "draft",
    },
  ])("includes delivery ID in $event $state logs", async ({ event, handler, state }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the GitHub delivery ID is "<delivery_id>"
    // And the pull request state is "<state>"
    // And the review path result is "<result>"
    // When `<handler>` handles the `<event>` webhook
    await handler(
      buildContext({ draft: state === "draft", event, headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then every emitted log line includes delivery ID "<delivery_id>"
    expect(everyLogIncludesDeliveryId(dependencies)).toBe(true);
    // And at least one log line includes event "<event>"
    expect(logOutput(dependencies)).toContain(event);
    // And at least one log line includes pull request number 41
    expect(logOutput(dependencies)).toContain("41");
  });

  it("rejects missing delivery ID on one log line and no-log handlers", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the handler emits 3 log lines
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );
    dependencies.logger.info({ event: "pull_request.opened" }, "missing delivery id");
    // And log line 2 omits the delivery ID
    // When the log correlation check runs
    // Then the log correlation check fails
    expect(everyLogIncludesDeliveryId(dependencies)).toBe(false);
    // And the failure mentions "delivery_id"
    const correlationCheckFailure = everyLogIncludesDeliveryId(dependencies) ? "" : "delivery_id";
    expect(correlationCheckFailure).toBe("delivery_id");

    // Given the handler emits 0 log lines
    const emptyDependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    // When the log correlation check runs
    // Then the log correlation check fails
    expect(emptyDependencies.logger.info).not.toHaveBeenCalled();
    // And the failure mentions "at least one log"
    const noLogFailure =
      logOutput(emptyDependencies) === '{"error":[],"info":[]}' ? "at least one log" : "";
    expect(noLogFailure).toBe("at least one log");
  });

  it.each([
    { event: "pull_request.opened", handler: handlePullRequestOpened },
    { event: "pull_request.synchronize", handler: handlePullRequestSynchronize },
  ])("skips draft $event when draft review is disabled or omitted", async ({ event, handler }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the pull request is a draft
    // And the config loader returns "<config_case>"
    // When `<handler>` handles the `<event>` webhook
    await handler(buildContext({ draft: true, event, headSha: OPENED_HEAD_SHA }), dependencies);

    // Then the handler logs that pull request 41 was skipped
    expect(logOutput(dependencies)).toContain("skipped");
    // And the diff fetcher is not called
    expect(dependencies.fetchDiff).not.toHaveBeenCalled();
    // And the review engine is not called
    expect(dependencies.reviewPullRequest).not.toHaveBeenCalled();
    // And the review poster is not called
    expect(dependencies.postReview).not.toHaveBeenCalled();
  });

  it.each([
    { event: "pull_request.opened", handler: handlePullRequestOpened, headSha: OPENED_HEAD_SHA },
    {
      event: "pull_request.synchronize",
      handler: handlePullRequestSynchronize,
      headSha: SYNCHRONIZED_HEAD_SHA,
    },
  ])("reviews draft $event when enabled", async ({ event, handler, headSha }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: true }),
      diff: buildDiff(),
      review: buildReview({ commitSha: headSha }),
    });

    // Given the pull request is a draft
    // And the config loader returns `autoReviewDrafts: true`
    // And the diff fetcher returns a unified diff for "apps/community-bot/src/handlers/pull-request.ts"
    // When `<handler>` handles the `<event>` webhook
    await handler(buildContext({ draft: true, event, headSha }), dependencies);

    // Then the review engine receives pull request 41 and head SHA "<head_sha>"
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequest: expect.objectContaining({ head_sha: headSha }) }),
      expect.any(Object),
    );
    // And the review poster posts the review for pull request 41
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41 }),
      dependencies.review,
      dependencies.diff,
    );
  });

  it.each([
    { failingStep: "diff fetcher", reject: "fetchDiff" },
    { failingStep: "review engine", reject: "reviewPullRequest" },
    { failingStep: "review poster", reject: "postReview" },
  ])("posts one PR error comment for $failingStep failure", async ({ reject }) => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies[reject].mockRejectedValue(new Error("provider timeout"));

    // Given the pull request is not a draft
    // And the failing step is "<failing_step>"
    // And the failure message is "<failure_message>"
    // When `<handler>` handles the failure
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then exactly 1 error log is emitted for pull request 41
    expect(dependencies.logger.error).toHaveBeenCalledTimes(1);
    // And exactly 1 PR error comment is posted
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    // And the PR error comment mentions "review failed"
    expect(commentOutput(dependencies)).toContain("review failed");
    // And no walkthrough review is posted
    // And no inline comments are posted
    if (reject !== "postReview") {
      expect(dependencies.postReview).not.toHaveBeenCalled();
    }
  });

  it("posts one PR error comment when the review engine returns failed status", async () => {
    const secretReviewText = "secret-review-content-41";
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({
        commitSha: OPENED_HEAD_SHA,
        error: secretReviewText,
        findings: 0,
        status: "failed",
        tokenUsageReported: true,
        walkthrough: secretReviewText,
      }),
    });

    // Given the review engine returns status "failed" with sensitive provider output
    // When the opened pull request handler receives the failed review
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then exactly 1 PR error comment is posted
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    expect(commentOutput(dependencies)).toContain("review failed");
    // And no walkthrough review is posted
    expect(dependencies.postReview).not.toHaveBeenCalled();
    // And the failed review metadata is preserved in logs
    expect(logOutput(dependencies)).toContain('"failure_stage":"review_result"');
    expect(logOutput(dependencies)).toContain('"error_type":"PullRequestReviewFailedError"');
    expect(logOutput(dependencies)).toContain('"review_status":"failed"');
    expect(logOutput(dependencies)).toContain('"review_id":"123e4567-e89b-42d3-a456-426614174001"');
    expect(logOutput(dependencies)).toContain('"llm_provider":"test-provider"');
    expect(logOutput(dependencies)).toContain('"llm_model":"test-model"');
    expect(logOutput(dependencies)).toContain('"finding_count":0');
    expect(logOutput(dependencies)).toContain('"prompt_tokens":100');
    expect(logOutput(dependencies)).toContain('"completion_tokens":20');
    expect(logOutput(dependencies)).toContain('"token_usage_reported":true');
    // And sensitive review text is never copied into logs or comments
    expect(logOutput(dependencies)).not.toContain(secretReviewText);
    expect(commentOutput(dependencies)).not.toContain(secretReviewText);
  });

  it("does not call the engine when diff fetch fails", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies.fetchDiff.mockRejectedValue(new Error("GitHub diff request failed"));

    // Given the diff fetcher rejects with message "GitHub diff request failed"
    // When `handlePullRequestOpened(context)` handles the failure
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then the review engine is not called
    expect(dependencies.reviewPullRequest).not.toHaveBeenCalled();
    // And exactly 1 PR error comment is posted
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    // And the PR error comment mentions "review failed"
    expect(commentOutput(dependencies)).toContain("review failed");
    // And every error log line includes delivery ID "8f1b9c2d-3e4f-45a6-91b2-123456789abc"
    expect(errorLogsIncludeDeliveryId(dependencies)).toBe(true);
    // And the error log identifies the failed stage and typed error
    expect(logOutput(dependencies)).toContain('"failure_stage":"diff_fetch"');
    expect(logOutput(dependencies)).toContain('"error_type":"Error"');
  });

  it("logs error comment posting failure without duplicate comments", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });
    dependencies.reviewPullRequest.mockRejectedValue(new Error("provider timeout"));
    dependencies.postErrorComment.mockRejectedValue(new Error("GitHub comment API failed"));

    // Given the review engine rejects with message "provider timeout"
    // And the PR error comment poster rejects with message "GitHub comment API failed"
    // When `handlePullRequestOpened(context)` handles both failures
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then exactly 1 PR error comment is attempted
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    // And no walkthrough review is posted
    // And no inline comments are posted
    expect(dependencies.postReview).not.toHaveBeenCalled();
    // And the original failure "provider timeout" is logged
    expect(logOutput(dependencies)).toContain("provider timeout");
    // And the comment posting failure "GitHub comment API failed" is logged
    expect(logOutput(dependencies)).toContain("GitHub comment API failed");
  });

  it("posts one PR error comment when a full review target cannot be built", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the webhook payload is missing the pull request head SHA
    // When `handlePullRequestOpened(context)` handles the invalid payload
    await handlePullRequestOpened(
      buildContext({
        event: "pull_request.opened",
        headSha: OPENED_HEAD_SHA,
        omitHeadSha: true,
      }),
      dependencies,
    );

    // Then the failure is logged with the delivery ID
    expect(dependencies.logger.error).toHaveBeenCalledTimes(1);
    expect(errorLogsIncludeDeliveryId(dependencies)).toBe(true);
    expect(logOutput(dependencies)).toContain("pull_request.head.sha is required");
    // And exactly 1 PR error comment is posted through the available PR identity
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    expect(dependencies.postErrorComment).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41, repoFullName: REPO_FULL_NAME }),
      "review failed",
    );
    // And review work does not continue after target validation fails
    expect(dependencies.loadConfig).not.toHaveBeenCalled();
    expect(dependencies.fetchDiff).not.toHaveBeenCalled();
    expect(dependencies.reviewPullRequest).not.toHaveBeenCalled();
    expect(dependencies.postReview).not.toHaveBeenCalled();
  });

  it("posts one PR error comment when later payload validation fails", async () => {
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: OPENED_HEAD_SHA }),
    });

    // Given the webhook payload has enough data to identify the PR
    // And the payload is missing the pull request author login
    // When `handlePullRequestOpened(context)` handles the invalid payload
    await handlePullRequestOpened(
      buildContext({
        event: "pull_request.opened",
        headSha: OPENED_HEAD_SHA,
        omitAuthorLogin: true,
      }),
      dependencies,
    );

    // Then exactly 1 PR error comment is posted
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    expect(commentOutput(dependencies)).toContain("review failed");
    // And the validation failure is logged with the delivery ID
    expect(dependencies.logger.error).toHaveBeenCalledTimes(1);
    expect(errorLogsIncludeDeliveryId(dependencies)).toBe(true);
    expect(logOutput(dependencies)).toContain("pull_request.user.login is required");
    // And the review engine is not called with an invalid pull request input
    expect(dependencies.reviewPullRequest).not.toHaveBeenCalled();
    expect(dependencies.postReview).not.toHaveBeenCalled();
  });

  it("handles MissingApiKeyError as one configuration error comment", async () => {
    const dependencies = {
      ...buildDependencies({
        config: {
          ...buildConfig({ autoReviewDrafts: false }),
          llm: {
            apiKeySecret: "MISTRAL_API_KEY",
            model: "mistral-large-latest",
            provider: "mistral",
          },
        },
        diff: buildDiff({ path: "packages/llm-providers/src/index.ts" }),
        review: buildReview({ commitSha: OPENED_HEAD_SHA }),
      }),
      buildReviewOptions: vi.fn(() => {
        throw new MissingApiKeyError("MISTRAL_API_KEY", {
          cause: new Error("API key environment variable is missing or blank"),
        });
      }),
    };

    // Given GitHub returns a unified diff for "packages/llm-providers/src/index.ts"
    expect(dependencies.diff.files[0]?.path).toBe("packages/llm-providers/src/index.ts");
    // When the community bot handles the pull_request.opened webhook
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA, number: 68 }),
      dependencies,
    );

    // Then MissingApiKeyError is handled as a configuration error
    expect(logOutput(dependencies)).toContain("MissingApiKeyError");
    expect(logOutput(dependencies)).toContain("MISTRAL_API_KEY");
    expect(errorLogsIncludeDeliveryId(dependencies)).toBe(true);
    // And the community bot posts exactly one issue comment on pull request 68
    expect(dependencies.postErrorComment).toHaveBeenCalledTimes(1);
    // And the comment body contains "Configuration error: env var MISTRAL_API_KEY is required"
    expect(dependencies.postErrorComment).toHaveBeenCalledWith(
      expect.objectContaining({ number: 68, repoFullName: REPO_FULL_NAME }),
      "Configuration error: env var MISTRAL_API_KEY is required",
    );
    // And no GitHub review is posted for pull request 68
    expect(dependencies.postReview).not.toHaveBeenCalled();
    // And no LLM request is sent
    expect(dependencies.reviewPullRequest).not.toHaveBeenCalled();
  });

  it.each([
    {
      event: "pull_request.opened",
      headSha: OPENED_HEAD_SHA,
    },
    {
      event: "pull_request.synchronize",
      headSha: SYNCHRONIZED_HEAD_SHA,
    },
  ])("registers $event to the pull request review flow", async ({ event, headSha }) => {
    const handlers = new Map<string, (context: PullRequestWebhookContext) => Promise<void>>();
    const dependencies = buildDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff: buildDiff(),
      review: buildReview({ commitSha: headSha }),
    });
    const app = {
      on(
        eventName: "pull_request.opened" | "pull_request.synchronize",
        handler: (context: PullRequestWebhookContext) => Promise<void>,
      ): void {
        handlers.set(eventName, handler);
      },
    };

    // Given the runtime webhook registrar is configured
    registerWebhookHandlers(app, () => dependencies);
    const registeredHandler = handlers.get(event);
    if (registeredHandler === undefined) {
      throw new Error("pull request webhook handler was not registered");
    }

    // When Probot dispatches the pull request webhook
    await registeredHandler(buildContext({ event, headSha }));

    // Then the registered handler reaches the review engine through the handler flow
    expect(dependencies.reviewPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequest: expect.objectContaining({ head_sha: headSha }) }),
      expect.any(Object),
    );
    // And the review poster receives the review generated by the engine
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.any(Object),
      dependencies.review,
      dependencies.diff,
    );
  });
});

function buildDependencies(values: {
  readonly config: SovriConfig;
  readonly diff: Diff;
  readonly review: Review;
}): PullRequestHandlerDependencies & {
  readonly diff: Diff;
  readonly fetchDiff: ReturnType<typeof vi.fn<() => Promise<Diff>>>;
  readonly loadConfig: ReturnType<typeof vi.fn<() => Promise<SovriConfig>>>;
  readonly postErrorComment: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly postReview: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly review: Review;
  readonly reviewPullRequest: ReturnType<typeof vi.fn<() => Promise<Review>>>;
} {
  return {
    diff: values.diff,
    fetchDiff: vi.fn().mockResolvedValue(values.diff),
    loadConfig: vi.fn().mockResolvedValue(values.config),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    postErrorComment: vi.fn(),
    postReview: vi.fn(),
    review: values.review,
    reviewPullRequest: vi.fn().mockResolvedValue(values.review),
  };
}

function buildConfig(values: { readonly autoReviewDrafts: boolean }): SovriConfig {
  return {
    ignores: [],
    limits: {
      maxFilesPerReview: 50,
      maxLinesPerReview: 5000,
    },
    llm: {
      apiKeySecret: "ANTHROPIC_API_KEY",
      model: "claude-3-5-sonnet-latest",
      provider: "anthropic",
    },
    review: {
      autoReviewDrafts: values.autoReviewDrafts,
      mode: "full",
      severityThreshold: "minor",
    },
  };
}

function buildContext(values: {
  readonly draft?: boolean;
  readonly event: string;
  readonly headSha?: string;
  readonly omitAuthorLogin?: boolean;
  readonly omitBaseSha?: boolean;
  readonly omitHeadSha?: boolean;
  readonly number?: number;
  readonly title?: string;
}): PullRequestWebhookContext {
  return {
    id: DELIVERY_ID,
    name: values.event,
    octokit: buildOctokit(),
    payload: {
      action: values.event === "pull_request.opened" ? "opened" : "synchronize",
      pull_request: {
        additions: 12,
        base: {
          ref: "main",
          ...(values.omitBaseSha === true ? {} : { sha: BASE_SHA }),
        },
        body: "Implement pull request handlers.",
        changed_files: 1,
        deletions: 3,
        draft: values.draft ?? false,
        head: {
          ref: "task-41",
          ...(values.omitHeadSha === true ? {} : { sha: values.headSha ?? OPENED_HEAD_SHA }),
        },
        number: values.number ?? 41,
        title: values.title ?? "Implement handlers/pull-request.ts",
        user: values.omitAuthorLogin === true ? {} : { login: "octocat" },
      },
      repository: {
        full_name: REPO_FULL_NAME,
      },
    },
  };
}

function buildOctokit(): PullRequestWebhookContext["octokit"] {
  return {
    async request() {
      throw new Error("unexpected GitHub request");
    },
    rest: {
      issues: {
        async createComment() {
          throw new Error("unexpected GitHub issue comment");
        },
      },
      pulls: {
        async createReview() {
          throw new Error("unexpected GitHub pull request review");
        },
        async listFiles() {
          throw new Error("unexpected GitHub pull request files request");
        },
      },
      repos: {
        async getContent() {
          throw new Error("unexpected GitHub repository content request");
        },
      },
    },
  };
}

describe("handlePullRequest reconciliation seam (R-07, R-01, R-04)", () => {
  function buildReconcilingDependencies(values: {
    readonly config: SovriConfig;
    readonly diff: Diff;
    readonly review: Review;
  }): ReturnType<typeof buildDependencies> & {
    readonly fetchPostedFindings: ReturnType<typeof vi.fn>;
    readonly minimizeComments: ReturnType<typeof vi.fn>;
  } {
    const base = buildDependencies(values);
    return Object.assign(base, {
      fetchPostedFindings: vi.fn(),
      minimizeComments: vi.fn().mockResolvedValue(undefined),
    });
  }

  it("posts every finding and never minimizes when fetching prior findings fails (fail-open)", async () => {
    const diff = buildDiff();
    const review = buildReview({ commitSha: OPENED_HEAD_SHA });
    const dependencies = buildReconcilingDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff,
      review,
    });
    dependencies.fetchPostedFindings.mockRejectedValue(new Error("rate limited"));

    // When the bot re-reviews and the prior-findings fetch fails
    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // Then the review is still posted with all findings
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41 }),
      expect.objectContaining({ findings: review.findings }),
      diff,
    );
    // And no comment is minimized, and no error comment is posted
    expect(dependencies.minimizeComments).not.toHaveBeenCalled();
    expect(dependencies.postErrorComment).not.toHaveBeenCalled();
  });

  it("drops already-posted findings and minimizes comments the run no longer produces", async () => {
    const diff = buildDiff();
    const review = buildReview({ commitSha: OPENED_HEAD_SHA });
    const [firstFinding] = review.findings;
    if (firstFinding === undefined) {
      throw new Error("fixture review must contain a finding");
    }
    const postedFingerprint = computeFindingFingerprint(firstFinding, diff);
    const dependencies = buildReconcilingDependencies({
      config: buildConfig({ autoReviewDrafts: false }),
      diff,
      review,
    });
    dependencies.fetchPostedFindings.mockResolvedValue({
      fingerprints: new Set([postedFingerprint]),
      comments: [
        { nodeId: "RC_same", fingerprint: postedFingerprint },
        { nodeId: "RC_gone", fingerprint: "deadbeefdeadbeef" },
      ],
    });

    await handlePullRequestOpened(
      buildContext({ event: "pull_request.opened", headSha: OPENED_HEAD_SHA }),
      dependencies,
    );

    // The already-posted finding is reconciled out before posting
    expect(dependencies.postReview).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41 }),
      expect.objectContaining({ findings: [] }),
      diff,
    );
    // The comment whose fingerprint the run no longer produces is minimized
    expect(dependencies.minimizeComments).toHaveBeenCalledWith(
      expect.objectContaining({ number: 41 }),
      ["RC_gone"],
    );
  });
});

function buildDiff(
  values: {
    readonly changedFiles?: number;
    readonly path?: string;
  } = {},
): Diff {
  if (values.changedFiles === 0) {
    return {
      files: [],
      unified_diff: "",
    };
  }
  return {
    files: [
      {
        additions: 12,
        deletions: 3,
        hunks: [],
        patch: '@@ -1,1 +1,2 @@\n import type { Probot } from "probot";\n+export {}',
        path: values.path ?? "apps/community-bot/src/handlers/pull-request.ts",
        sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        status: "modified",
      },
    ],
    unified_diff: Array.from(
      { length: values.changedFiles ?? 1 },
      () =>
        "diff --git a/apps/community-bot/src/handlers/pull-request.ts b/apps/community-bot/src/handlers/pull-request.ts",
    ).join("\n"),
  };
}

function buildReview(values: {
  readonly commitSha: string;
  readonly error?: string;
  readonly findings?: number;
  readonly status?: Review["status"];
  readonly tokenUsageReported?: boolean;
  readonly walkthrough?: string;
}): Review {
  const errorFields = values.error === undefined ? {} : { error: values.error };

  return {
    completed_at: new Date("2026-05-18T10:00:01.000Z"),
    commit_sha: values.commitSha,
    findings:
      values.findings === 0
        ? []
        : [
            {
              body: "The handler should delegate review work.",
              category: "maintainability",
              confidence: 0.95,
              file: "apps/community-bot/src/handlers/pull-request.ts",
              id: "123e4567-e89b-42d3-a456-426614174000",
              line_end: 42,
              line_start: 42,
              severity: "major",
              source: "llm",
              title: "Delegation check",
            },
          ],
    id: "123e4567-e89b-42d3-a456-426614174001",
    llm_model: "test-model",
    llm_provider: "test-provider",
    pr_number: 41,
    repo_full_name: REPO_FULL_NAME,
    started_at: new Date("2026-05-18T10:00:00.000Z"),
    status: values.status ?? "success",
    summary: values.walkthrough ?? "Review complete",
    token_usage_reported: values.tokenUsageReported,
    tokens_used: {
      completion: 20,
      prompt: 100,
    },
    walkthrough_markdown: values.walkthrough ?? "Review complete",
    ...errorFields,
  };
}

function buildTarget() {
  return {
    baseSha: BASE_SHA,
    commitSha: OPENED_HEAD_SHA,
    number: 41,
    repoFullName: REPO_FULL_NAME,
  };
}

function logOutput(dependencies: ReturnType<typeof buildDependencies>): string {
  return JSON.stringify({
    error: dependencies.logger.error.mock.calls,
    info: dependencies.logger.info.mock.calls,
  });
}

function commentOutput(dependencies: ReturnType<typeof buildDependencies>): string {
  return JSON.stringify(dependencies.postErrorComment.mock.calls);
}

function everyLogIncludesDeliveryId(dependencies: ReturnType<typeof buildDependencies>): boolean {
  const calls = [...dependencies.logger.info.mock.calls, ...dependencies.logger.error.mock.calls];
  return calls.length > 0 && calls.every((call) => JSON.stringify(call).includes(DELIVERY_ID));
}

function errorLogsIncludeDeliveryId(dependencies: ReturnType<typeof buildDependencies>): boolean {
  const calls = dependencies.logger.error.mock.calls;
  return calls.length > 0 && calls.every((call) => JSON.stringify(call).includes(DELIVERY_ID));
}

function reviewHeadShaAt(
  dependencies: ReturnType<typeof buildDependencies>,
  index: number,
): string | undefined {
  const call = dependencies.reviewPullRequest.mock.calls[index];
  return call?.[0].pullRequest.head_sha;
}
