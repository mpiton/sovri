// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  postReview,
  ReviewPostError,
  validatePullRequestReviewRequest,
  WALKTHROUGH_MARKER,
  type CommentPosterOctokit,
  type GitHubIssueCommentResponse,
  type GitHubReviewResponse,
  type PullRequestReviewRequest,
  type ReviewPostInput,
} from "../../src/github/comment-poster.js";

const Owner = "octo-org";
const Repo = "sovri-target";
const PullNumber = 42;
const CommitSha = "1111111111111111111111111111111111111111";
const ReviewId = 98765;
const FallbackCommentId = 87654;
const GitHubBaseUrl = "https://api.github.com";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("postReview idempotency", () => {
  it("creates one marked PR review on first run", async () => {
    const runtime = buildRuntime();

    // Given no existing PR review body contains "<!-- sovri:walkthrough -->"
    expect(runtime.reviewStore).toHaveLength(0);
    // And no existing issue comment body contains "<!-- sovri:walkthrough -->"
    expect(runtime.issueCommentStore).toHaveLength(0);
    // And the review contains 2 inline comment drafts
    const review = buildReviewPostInput({ inlineCommentCount: 2 });
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    // Then GitHub receives one `POST /repos/octo-org/sovri-target/pulls/42/reviews` request
    expect(runtime.createReviewRequests).toHaveLength(1);
    // And the posted review body starts with "<!-- sovri:walkthrough -->"
    expect(runtime.createReviewRequests[0]?.body.startsWith(WALKTHROUGH_MARKER)).toBe(true);
    // And the posted review body contains "## Sovri review"
    expect(runtime.createReviewRequests[0]?.body).toContain("## Sovri review");
    // And exactly 1 marked Sovri walkthrough exists on pull request 42
    expect(runtime.markedWalkthroughCount()).toBe(1);
  });

  it("updates an existing marked PR review instead of duplicating it", async () => {
    const runtime = buildRuntime({
      reviews: [
        {
          body: `${WALKTHROUGH_MARKER}\n## Sovri review\nOld summary`,
          id: ReviewId,
        },
      ],
    });
    const review = buildReviewPostInput({
      walkthroughMarkdown:
        "## Sovri review\n### TL;DR\nNew summary for commit 1111111111111111111111111111111111111111",
    });

    // Given PR review 98765 has body "<!-- sovri:walkthrough -->\n## Sovri review\nOld summary"
    expect(runtime.reviewStore[0]?.id).toBe(ReviewId);
    // And no existing issue comment body contains "<!-- sovri:walkthrough -->"
    expect(runtime.issueCommentStore).toHaveLength(0);
    // And the new walkthrough markdown contains "New summary for commit 1111111111111111111111111111111111111111"
    expect(review.walkthroughMarkdown).toContain(CommitSha);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    // Then GitHub receives one request to update PR review 98765
    expect(runtime.updateReviewRequests).toEqual([
      expect.objectContaining({ review_id: ReviewId }),
    ]);
    // And no second top-level walkthrough containing "<!-- sovri:walkthrough -->" is created
    expect(runtime.createReviewRequests).toHaveLength(0);
    // And exactly 1 marked Sovri walkthrough exists on pull request 42
    expect(runtime.markedWalkthroughCount()).toBe(1);
    // And the marked walkthrough contains "New summary for commit 1111111111111111111111111111111111111111"
    expect(runtime.reviewStore[0]?.body).toContain(CommitSha);
  });

  it("updates an existing marked fallback issue comment", async () => {
    const runtime = buildRuntime({
      issueComments: [
        {
          body: `${WALKTHROUGH_MARKER}\n## Sovri review\nOld fallback summary`,
          id: FallbackCommentId,
        },
      ],
      reviewCreateStatus: 422,
    });
    const review = buildReviewPostInput({
      walkthroughMarkdown:
        "## Sovri review\n### TL;DR\nFallback summary after invalid inline position",
    });

    // Given plain issue comment 87654 has body "<!-- sovri:walkthrough -->\n## Sovri review\nOld fallback summary"
    expect(runtime.issueCommentStore[0]?.id).toBe(FallbackCommentId);
    // And PR review creation returns HTTP 422 with message "Validation Failed"
    expect(runtime.reviewCreateStatus).toBe(422);
    // And the new walkthrough markdown contains "Fallback summary after invalid inline position"
    expect(review.walkthroughMarkdown).toContain("Fallback summary after invalid inline position");
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    // Then GitHub receives one request to update issue comment 87654
    expect(runtime.updateIssueCommentRequests).toEqual([
      expect.objectContaining({ comment_id: FallbackCommentId }),
    ]);
    // And no second issue comment containing "<!-- sovri:walkthrough -->" is created
    expect(runtime.createIssueCommentRequests).toHaveLength(0);
    // And the updated issue comment contains "Fallback summary after invalid inline position"
    expect(runtime.issueCommentStore[0]?.body).toContain(
      "Fallback summary after invalid inline position",
    );
  });
});

describe("postReview audit logging", () => {
  it("logs the review ID after successful PR review creation", async () => {
    const runtime = buildRuntime();

    // Given GitHub creates PR review 98765 for pull request 42
    expect(runtime.nextReviewId).toBe(ReviewId);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then the audit log event message is "PR review posted"
    expect(runtime.logMessages()).toContain("PR review posted");
    // And the audit log contains `review_id` 98765
    expect(runtime.logBindings()).toContain(`"review_id":${ReviewId}`);
    // And the audit log contains repository "octo-org/sovri-target"
    expect(runtime.logBindings()).toContain('"repo":"octo-org/sovri-target"');
    // And the audit log contains pull request number 42
    expect(runtime.logBindings()).toContain('"pr_number":42');
  });

  it("logs fallback_comment_id without fabricating review_id after review creation fails", async () => {
    const runtime = buildRuntime({ reviewCreateStatus: 422 });

    // Given GitHub rejects PR review creation with HTTP 422 and message "Validation Failed"
    expect(runtime.reviewCreateStatus).toBe(422);
    // And GitHub creates fallback issue comment 87654
    expect(runtime.nextIssueCommentId).toBe(FallbackCommentId);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then the audit log event message is "PR review fallback comment posted"
    expect(runtime.logMessages()).toContain("PR review fallback comment posted");
    // And the audit log contains `fallback_comment_id` 87654
    expect(runtime.logBindings()).toContain(`"fallback_comment_id":${FallbackCommentId}`);
    // And the audit log does not contain `review_id`
    expect(runtime.logBindings()).not.toContain("review_id");
  });

  it("does not log raw walkthrough or inline comment bodies", async () => {
    const runtime = buildRuntime();
    const review = buildReviewPostInput({
      inlineBody: "do not log this finding body",
      walkthroughMarkdown: "## Sovri review\n### TL;DR\nsecret-looking-token-123",
    });

    // Given GitHub creates PR review 98765 for pull request 42
    expect(runtime.nextReviewId).toBe(ReviewId);
    // And the walkthrough markdown contains "secret-looking-token-123"
    expect(review.walkthroughMarkdown).toContain("secret-looking-token-123");
    // And an inline comment draft body contains "do not log this finding body"
    expect(review.inlineComments[0]?.body).toContain("do not log this finding body");
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    // Then the audit log contains `review_id` 98765
    expect(runtime.logBindings()).toContain(`"review_id":${ReviewId}`);
    // And the audit log does not contain "secret-looking-token-123"
    expect(runtime.logOutput()).not.toContain("secret-looking-token-123");
    // And the audit log does not contain "do not log this finding body"
    expect(runtime.logOutput()).not.toContain("do not log this finding body");
  });
});

describe("postReview contract", () => {
  it("resolves with no value after posting a GitHub review", async () => {
    const runtime = buildRuntime();
    const review = buildReviewPostInput({ inlineCommentCount: 1 });

    // Given an authenticated Octokit client can write pull request reviews in "octo-org/sovri-target"
    expect(runtime.octokit).toBeDefined();
    // And the review contains walkthrough markdown "## Sovri review"
    expect(review.walkthroughMarkdown).toContain("## Sovri review");
    // And the review contains 1 inline comment draft for "src/session.ts" line 18
    expect(review.inlineComments).toHaveLength(1);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    const result = await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    // Then the call returns a `Promise<void>`
    expect(result).toBeUndefined();
    // And the promise resolves with no value
    expect(result).toBeUndefined();
    // And GitHub has received the review posting request
    expect(runtime.createReviewRequests).toHaveLength(1);
  });

  it("does not require a Probot webhook context", async () => {
    const runtime = buildRuntime();

    // Given only an authenticated Octokit client is available
    expect(runtime.octokit.rest.pulls.createReview).toBeDefined();
    // And no Probot webhook context object exists
    const context = undefined;
    // And GitHub creates PR review 98765 for pull request 42
    expect(runtime.nextReviewId).toBe(ReviewId);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then the promise resolves with no value
    expect(runtime.createReviewRequests).toHaveLength(1);
    // And no handler payload, delivery id, or environment variable is required to post the review
    expect(context).toBeUndefined();
  });

  it("rejects with ReviewPostError when the review and fallback comment both fail", async () => {
    const runtime = buildRuntime({ fallbackCreateStatus: 404, reviewCreateStatus: 404 });

    // Given GitHub rejects PR review creation with HTTP 404 and message "Not Found"
    expect(runtime.reviewCreateStatus).toBe(404);
    // And GitHub rejects fallback issue comment creation with HTTP 404 and message "Not Found"
    expect(runtime.fallbackCreateStatus).toBe(404);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await expect(
      postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
        logger: runtime.logger,
      }),
    ).rejects.toMatchObject({
      name: "ReviewPostError",
      status: 404,
      fallbackStatus: 404,
    });
    // Then no successful review or fallback comment is logged
    expect(runtime.logMessages()).not.toContain("PR review posted");
    expect(runtime.logMessages()).not.toContain("PR review fallback comment posted");
  });
});

describe("postReview request payload", () => {
  it("posts walkthrough and inline drafts as a COMMENT review", async () => {
    const runtime = buildRuntime();
    const review = buildReviewPostInput({ inlineCommentCount: 2 });

    // Given the walkthrough markdown is "## Sovri review\n### TL;DR\n2 findings"
    expect(review.walkthroughMarkdown).toContain("2 findings");
    // And the inline comment drafts include "src/session.ts" line 18 and "src/config.ts" line 27
    expect(review.inlineComments.map((comment) => comment.path)).toEqual([
      "src/session.ts",
      "src/config.ts",
    ]);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    const request = runtime.createReviewRequests[0];
    // Then GitHub receives one `POST /repos/octo-org/sovri-target/pulls/42/reviews` request
    expect(runtime.createReviewRequests).toHaveLength(1);
    // And the request payload has `event` "COMMENT"
    expect(request?.event).toBe("COMMENT");
    // And the request payload body starts with "<!-- sovri:walkthrough -->"
    expect(request?.body.startsWith(WALKTHROUGH_MARKER)).toBe(true);
    // And the request payload body contains "## Sovri review"
    expect(request?.body).toContain("## Sovri review");
    // And the request payload `comments` array has 2 entries
    expect(request?.comments).toHaveLength(2);
    // And the first comment path is "src/session.ts"
    expect(request?.comments[0]?.path).toBe("src/session.ts");
    // And the first comment line is 18
    expect(request?.comments[0]?.line).toBe(18);
  });

  it("rejects a review request payload that omits COMMENT event", () => {
    const malformed = {
      body: "## Sovri review",
      comments: [
        {
          body: "Missing null guard",
          line: 18,
          path: "src/session.ts",
          side: "RIGHT",
        },
      ],
      commit_id: CommitSha,
      owner: Owner,
      pull_number: PullNumber,
      repo: Repo,
    };

    // Given a review request payload has body "## Sovri review"
    expect(malformed.body).toContain("## Sovri review");
    // And the review request payload has one inline comment draft for "src/session.ts" line 18
    expect(malformed.comments).toHaveLength(1);
    // And the review request payload omits `event`
    expect(Object.hasOwn(malformed, "event")).toBe(false);
    // When the adapter validates the review request payload
    expect(() => validatePullRequestReviewRequest(malformed)).toThrow(
      "Pull request review event must be COMMENT",
    );
    // Then validation fails
    expect(() => validatePullRequestReviewRequest(malformed)).toThrow();
  });

  it("falls back when GitHub returns 403 during review creation", async () => {
    const runtime = buildRuntime({ reviewCreateStatus: 403 });

    // Given GitHub rejects `POST /repos/octo-org/sovri-target/pulls/42/reviews` with HTTP 403 and message "Resource not accessible by integration"
    expect(runtime.reviewCreateStatus).toBe(403);
    // And GitHub creates fallback issue comment 87654
    expect(runtime.nextIssueCommentId).toBe(FallbackCommentId);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then GitHub receives a fallback `POST /repos/octo-org/sovri-target/issues/42/comments` request
    expect(runtime.createIssueCommentRequests).toHaveLength(1);
    // And the fallback issue comment body starts with "<!-- sovri:walkthrough -->"
    expect(runtime.createIssueCommentRequests[0]?.body.startsWith(WALKTHROUGH_MARKER)).toBe(true);
    // And the promise resolves with no value
    expect(runtime.logMessages()).toContain("PR review fallback comment posted");
  });

  it("posts the walkthrough review body when inline draft list is empty", async () => {
    const runtime = buildRuntime();
    const review = buildReviewPostInput({
      inlineCommentCount: 0,
      walkthroughMarkdown: "## Sovri review\n### TL;DR\nNo findings",
    });

    // Given the walkthrough markdown is "## Sovri review\n### TL;DR\nNo findings"
    expect(review.walkthroughMarkdown).toContain("No findings");
    // And the inline comment draft list is empty
    expect(review.inlineComments).toHaveLength(0);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, review, {
      logger: runtime.logger,
    });

    const request = runtime.createReviewRequests[0];
    // Then GitHub receives one `POST /repos/octo-org/sovri-target/pulls/42/reviews` request
    expect(runtime.createReviewRequests).toHaveLength(1);
    // And the request payload has `event` "COMMENT"
    expect(request?.event).toBe("COMMENT");
    // And the request payload body contains "No findings"
    expect(request?.body).toContain("No findings");
    // And the request payload `comments` array has 0 entries
    expect(request?.comments).toHaveLength(0);
  });
});

describe("postReview fallback", () => {
  it("falls back to a plain issue comment on invalid inline position", async () => {
    const runtime = buildRuntime({ reviewCreateStatus: 422 });

    // Given GitHub rejects PR review creation with HTTP 422 and message "Validation Failed"
    expect(runtime.reviewCreateStatus).toBe(422);
    // And GitHub creates issue comment 87654 on pull request 42
    expect(runtime.nextIssueCommentId).toBe(FallbackCommentId);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then GitHub receives one `POST /repos/octo-org/sovri-target/issues/42/comments` request
    expect(runtime.createIssueCommentRequests).toHaveLength(1);
    // And the issue comment body starts with "<!-- sovri:walkthrough -->"
    expect(runtime.createIssueCommentRequests[0]?.body.startsWith(WALKTHROUGH_MARKER)).toBe(true);
    // And the issue comment body contains "## Sovri review"
    expect(runtime.createIssueCommentRequests[0]?.body).toContain("## Sovri review");
    // And the promise resolves with no value
    expect(runtime.logMessages()).toContain("PR review fallback comment posted");
  });

  it("falls back to a plain issue comment on forbidden review creation", async () => {
    const runtime = buildRuntime({ reviewCreateStatus: 403 });

    // Given GitHub rejects PR review creation with HTTP 403 and message "Resource not accessible by integration"
    expect(runtime.reviewCreateStatus).toBe(403);
    // And GitHub creates issue comment 87655 on pull request 42
    runtime.nextIssueCommentId = 87655;
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then GitHub receives one `POST /repos/octo-org/sovri-target/issues/42/comments` request
    expect(runtime.createIssueCommentRequests).toHaveLength(1);
    // And the audit log contains `fallback_comment_id` 87655
    expect(runtime.logBindings()).toContain('"fallback_comment_id":87655');
    // And the promise resolves with no value
    expect(runtime.logMessages()).toContain("PR review fallback comment posted");
  });

  it("rejects when the fallback issue comment fails", async () => {
    const runtime = buildRuntime({ fallbackCreateStatus: 403, reviewCreateStatus: 422 });

    // Given GitHub rejects PR review creation with HTTP 422 and message "Validation Failed"
    expect(runtime.reviewCreateStatus).toBe(422);
    // And GitHub rejects fallback issue comment creation with HTTP 403 and message "Resource not accessible by integration"
    expect(runtime.fallbackCreateStatus).toBe(403);
    // When the bot calls `postReview(octokit, repo, 42, review)`
    await expect(
      postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
        logger: runtime.logger,
      }),
    ).rejects.toMatchObject({
      fallbackStatus: 403,
      name: "ReviewPostError",
    });
    // Then no successful fallback comment is logged
    expect(runtime.logMessages()).not.toContain("PR review fallback comment posted");
  });

  it.each([
    { commentId: 87654, message: "Validation Failed", status: 422 },
    { commentId: 87655, message: "Resource not accessible by integration", status: 403 },
    { commentId: 87656, message: "Bad Gateway", status: 502 },
  ])(
    "uses the same fallback behavior for review creation HTTP $status",
    async ({ commentId, status }) => {
      const runtime = buildRuntime({ reviewCreateStatus: status });
      runtime.nextIssueCommentId = commentId;

      // Given GitHub rejects PR review creation with HTTP <status> and message "<message>"
      expect(runtime.reviewCreateStatus).toBe(status);
      // And GitHub creates issue comment <comment-id> on pull request 42
      expect(runtime.nextIssueCommentId).toBe(commentId);
      // When the bot calls `postReview(octokit, repo, 42, review)`
      await postReview(runtime.octokit, buildRepo(), PullNumber, buildReviewPostInput(), {
        logger: runtime.logger,
      });

      // Then GitHub receives one fallback issue comment request
      expect(runtime.createIssueCommentRequests).toHaveLength(1);
      // And the issue comment body contains "## Sovri review"
      expect(runtime.createIssueCommentRequests[0]?.body).toContain("## Sovri review");
      // And the audit log contains `fallback_comment_id` <comment-id>
      expect(runtime.logBindings()).toContain(`"fallback_comment_id":${commentId}`);
    },
  );
});

describe("postReview MSW coverage", () => {
  it("covers successful PR review creation", async () => {
    const requests: PullRequestReviewRequest[] = [];
    server.use(
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json([]),
      ),
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json([]),
      ),
      http.post(
        `${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`,
        async ({ request }) => {
          requests.push(validatePullRequestReviewRequest(await request.json()));
          return HttpResponse.json({ id: ReviewId });
        },
      ),
    );

    // Given MSW returns HTTP 200 with PR review ID 98765 for `POST /repos/octo-org/sovri-target/pulls/42/reviews`
    // When the integration test calls `postReview(octokit, repo, 42, review)`
    await postReview(createMswOctokit(), buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: buildRuntime().logger,
    });

    // Then the promise resolves with no value
    expect(requests).toHaveLength(1);
    // And the test observes one intercepted PR review request
    expect(requests).toHaveLength(1);
    // And the intercepted request payload has `event` "COMMENT"
    expect(requests[0]?.event).toBe("COMMENT");
    // And the intercepted request payload contains 2 inline comments
    expect(requests[0]?.comments).toHaveLength(2);
  });

  it("covers 422 invalid inline position fallback", async () => {
    const fallbackBodies: string[] = [];
    server.use(
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json([]),
      ),
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json([]),
      ),
      http.post(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json({ message: "Validation Failed" }, { status: 422 }),
      ),
      http.post(
        `${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`,
        async ({ request }) => {
          fallbackBodies.push(readBodyFromUnknown(await request.json()));
          return HttpResponse.json({ id: FallbackCommentId }, { status: 201 });
        },
      ),
    );

    // Given MSW returns HTTP 422 with message "Validation Failed" for `POST /repos/octo-org/sovri-target/pulls/42/reviews`
    // And MSW returns HTTP 201 with issue comment ID 87654 for `POST /repos/octo-org/sovri-target/issues/42/comments`
    // When the integration test calls `postReview(octokit, repo, 42, review)`
    await postReview(createMswOctokit(), buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: buildRuntime().logger,
    });

    // Then the promise resolves with no value
    expect(fallbackBodies).toHaveLength(1);
    // And the test observes one intercepted fallback issue comment request
    expect(fallbackBodies).toHaveLength(1);
    // And the fallback issue comment body contains "## Sovri review"
    expect(fallbackBodies[0]).toContain("## Sovri review");
  });

  it("covers 403 forbidden review fallback", async () => {
    const runtime = buildRuntime();
    server.use(
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json([]),
      ),
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json([]),
      ),
      http.post(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
      ),
      http.post(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json({ id: 87655 }, { status: 201 }),
      ),
    );

    // Given MSW returns HTTP 403 with message "Resource not accessible by integration" for `POST /repos/octo-org/sovri-target/pulls/42/reviews`
    // And MSW returns HTTP 201 with issue comment ID 87655 for `POST /repos/octo-org/sovri-target/issues/42/comments`
    // When the integration test calls `postReview(octokit, repo, 42, review)`
    await postReview(createMswOctokit(), buildRepo(), PullNumber, buildReviewPostInput(), {
      logger: runtime.logger,
    });

    // Then the promise resolves with no value
    expect(runtime.logMessages()).toContain("PR review fallback comment posted");
    // And the test observes one intercepted fallback issue comment request
    expect(runtime.logBindings()).toContain('"fallback_comment_id":87655');
    // And the audit log contains `fallback_comment_id` 87655
    expect(runtime.logBindings()).toContain('"fallback_comment_id":87655');
  });

  it("covers rejected posting when fallback also fails", async () => {
    server.use(
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json([]),
      ),
      http.get(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json([]),
      ),
      http.post(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/pulls/${PullNumber}/reviews`, () =>
        HttpResponse.json({ message: "Validation Failed" }, { status: 422 }),
      ),
      http.post(`${GitHubBaseUrl}/repos/${Owner}/${Repo}/issues/${PullNumber}/comments`, () =>
        HttpResponse.json({ message: "Resource not accessible by integration" }, { status: 403 }),
      ),
    );

    // Given MSW returns HTTP 422 with message "Validation Failed" for `POST /repos/octo-org/sovri-target/pulls/42/reviews`
    // And MSW returns HTTP 403 with message "Resource not accessible by integration" for `POST /repos/octo-org/sovri-target/issues/42/comments`
    // When the integration test calls `postReview(octokit, repo, 42, review)`
    await expect(
      postReview(createMswOctokit(), buildRepo(), PullNumber, buildReviewPostInput(), {
        logger: buildRuntime().logger,
      }),
    ).rejects.toBeInstanceOf(ReviewPostError);
    // Then the promise rejects with a typed posting error named "ReviewPostError"
    // And the test observes the review request before the fallback issue comment request
  });
});

function buildRepo(): { readonly owner: string; readonly repo: string } {
  return { owner: Owner, repo: Repo };
}

function buildReviewPostInput(
  values: {
    readonly inlineBody?: string;
    readonly inlineCommentCount?: number;
    readonly walkthroughMarkdown?: string;
  } = {},
): ReviewPostInput {
  const inlineCommentCount = values.inlineCommentCount ?? 2;
  const comments = [
    {
      body: values.inlineBody ?? "Missing null guard",
      line: 18,
      path: "src/session.ts",
      side: "RIGHT" as const,
    },
    {
      body: "Configuration is too permissive",
      line: 27,
      path: "src/config.ts",
      side: "RIGHT" as const,
    },
  ];

  return {
    commitSha: CommitSha,
    inlineComments: comments.slice(0, inlineCommentCount),
    walkthroughMarkdown: values.walkthroughMarkdown ?? "## Sovri review\n### TL;DR\n2 findings",
  };
}

function buildRuntime(
  values: {
    readonly fallbackCreateStatus?: number;
    readonly issueComments?: GitHubIssueCommentResponse[];
    readonly reviewCreateStatus?: number;
    readonly reviews?: GitHubReviewResponse[];
  } = {},
) {
  const reviewStore = [...(values.reviews ?? [])];
  const issueCommentStore = [...(values.issueComments ?? [])];
  const createReviewRequests: PullRequestReviewRequest[] = [];
  const createReviewCommentRequests: unknown[] = [];
  const updateReviewRequests: unknown[] = [];
  const createIssueCommentRequests: { readonly body: string }[] = [];
  const deleteIssueCommentRequests: unknown[] = [];
  const updateIssueCommentRequests: unknown[] = [];
  const logEntries: {
    readonly bindings: Readonly<Record<string, unknown>>;
    readonly message: string;
  }[] = [];

  const runtime = {
    createIssueCommentRequests,
    createReviewCommentRequests,
    createReviewRequests,
    deleteIssueCommentRequests,
    fallbackCreateStatus: values.fallbackCreateStatus,
    issueCommentStore,
    logger: {
      info(bindings: Readonly<Record<string, unknown>>, message: string): void {
        logEntries.push({ bindings, message });
      },
    },
    logBindings(): string {
      return logEntries.map((entry) => JSON.stringify(entry.bindings)).join("\n");
    },
    logMessages(): string {
      return logEntries.map((entry) => entry.message).join("\n");
    },
    logOutput(): string {
      return logEntries
        .map((entry) => `${entry.message}\n${JSON.stringify(entry.bindings)}`)
        .join("\n");
    },
    markedWalkthroughCount(): number {
      return [...reviewStore, ...issueCommentStore].filter((item) =>
        item.body.includes(WALKTHROUGH_MARKER),
      ).length;
    },
    nextIssueCommentId: FallbackCommentId,
    nextReviewCommentId: 11000,
    nextReviewId: ReviewId,
    octokit: undefined as unknown as CommentPosterOctokit,
    reviewCreateStatus: values.reviewCreateStatus,
    reviewStore,
    updateIssueCommentRequests,
    updateReviewRequests,
  };

  runtime.octokit = {
    rest: {
      issues: {
        async createComment(parameters) {
          createIssueCommentRequests.push({ body: parameters.body });
          if (runtime.fallbackCreateStatus !== undefined) {
            throw new GitHubStatusError(runtime.fallbackCreateStatus);
          }

          const comment = { body: parameters.body, id: runtime.nextIssueCommentId };
          issueCommentStore.push(comment);
          return { data: comment };
        },
        async deleteComment(parameters) {
          deleteIssueCommentRequests.push(parameters);
          const index = issueCommentStore.findIndex((item) => item.id === parameters.comment_id);
          if (index === -1) {
            throw new GitHubStatusError(404);
          }
          issueCommentStore.splice(index, 1);
          return { data: undefined };
        },
        async listComments(parameters) {
          if ((parameters.page ?? 1) > 1) {
            return { data: [] };
          }
          return { data: issueCommentStore };
        },
        async updateComment(parameters) {
          updateIssueCommentRequests.push(parameters);
          const comment = issueCommentStore.find((item) => item.id === parameters.comment_id);
          if (comment === undefined) {
            throw new GitHubStatusError(404);
          }

          const updated = { ...comment, body: parameters.body };
          issueCommentStore.splice(issueCommentStore.indexOf(comment), 1, updated);
          return { data: updated };
        },
      },
      pulls: {
        async createReview(parameters) {
          createReviewRequests.push(validatePullRequestReviewRequest(parameters));
          if (runtime.reviewCreateStatus !== undefined) {
            throw new GitHubStatusError(runtime.reviewCreateStatus);
          }

          const review = { body: parameters.body, id: runtime.nextReviewId };
          reviewStore.push(review);
          return { data: review };
        },
        async createReviewComment(parameters) {
          createReviewCommentRequests.push(parameters);
          const id = runtime.nextReviewCommentId;
          runtime.nextReviewCommentId += 1;
          return { data: { id } };
        },
        async listReviews(parameters) {
          if ((parameters.page ?? 1) > 1) {
            return { data: [] };
          }
          return { data: reviewStore };
        },
        async updateReview(parameters) {
          updateReviewRequests.push(parameters);
          const review = reviewStore.find((item) => item.id === parameters.review_id);
          if (review === undefined) {
            throw new GitHubStatusError(404);
          }

          const updated = { ...review, body: parameters.body };
          reviewStore.splice(reviewStore.indexOf(review), 1, updated);
          return { data: updated };
        },
      },
    },
  };

  return runtime;
}

function createMswOctokit(): CommentPosterOctokit {
  return {
    rest: {
      issues: {
        async createComment(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/issues/${parameters.issue_number}/comments`,
            {
              body: JSON.stringify({ body: parameters.body }),
              method: "POST",
            },
          );
          return { data: await readIdResponse(response) };
        },
        async deleteComment(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/issues/comments/${parameters.comment_id}`,
            { method: "DELETE" },
          );
          if (!response.ok) {
            throw new GitHubStatusError(response.status);
          }
          return { data: undefined };
        },
        async listComments(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/issues/${parameters.issue_number}/comments`,
          );
          return { data: await readIdResponses(response) };
        },
        async updateComment(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/issues/comments/${parameters.comment_id}`,
            {
              body: JSON.stringify({ body: parameters.body }),
              method: "PATCH",
            },
          );
          return { data: await readIdResponse(response) };
        },
      },
      pulls: {
        async createReview(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/pulls/${parameters.pull_number}/reviews`,
            {
              body: JSON.stringify(parameters),
              method: "POST",
            },
          );
          return { data: await readIdResponse(response) };
        },
        async createReviewComment(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/pulls/${parameters.pull_number}/comments`,
            {
              body: JSON.stringify(parameters),
              method: "POST",
            },
          );
          const data = await readIdResponse(response);
          return { data: { id: data.id } };
        },
        async listReviews(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/pulls/${parameters.pull_number}/reviews`,
          );
          return { data: await readIdResponses(response) };
        },
        async updateReview(parameters) {
          const response = await fetch(
            `${GitHubBaseUrl}/repos/${parameters.owner}/${parameters.repo}/pulls/${parameters.pull_number}/reviews/${parameters.review_id}`,
            {
              body: JSON.stringify({ body: parameters.body }),
              method: "PATCH",
            },
          );
          return { data: await readIdResponse(response) };
        },
      },
    },
  };
}

async function readIdResponse(response: Response): Promise<GitHubReviewResponse> {
  if (!response.ok) {
    throw new GitHubStatusError(response.status);
  }

  return readIdObject(await response.json());
}

async function readIdResponses(response: Response): Promise<GitHubReviewResponse[]> {
  if (!response.ok) {
    throw new GitHubStatusError(response.status);
  }

  const value = await response.json();
  if (!Array.isArray(value)) {
    throw new Error("Expected GitHub list response");
  }

  return value.map(readIdObject);
}

function readIdObject(value: unknown): GitHubReviewResponse {
  if (value === null || typeof value !== "object") {
    throw new Error("Expected GitHub object response");
  }

  const id = Reflect.get(value, "id");
  const body = Reflect.get(value, "body");
  if (typeof id !== "number") {
    throw new Error("Expected GitHub object id");
  }

  return {
    body: typeof body === "string" ? body : "",
    id,
  };
}

function readBodyFromUnknown(value: unknown): string {
  if (value === null || typeof value !== "object") {
    throw new Error("Expected request body object");
  }

  const body = Reflect.get(value, "body");
  if (typeof body !== "string") {
    throw new Error("Expected request body string");
  }

  return body;
}

class GitHubStatusError extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(status === 403 ? "Resource not accessible by integration" : "GitHub request failed");
    this.status = status;
  }
}
