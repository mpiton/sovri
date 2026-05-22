// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { existsSync, readFileSync } from "node:fs";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AnthropicMessagesUrl,
  GitHubIssueCommentsUrl,
  GitHubPullRequestFilesUrl,
  GitHubPullRequestReviewsUrl,
  handlerContracts,
} from "../../../tests/msw/handlers.js";
import {
  failOnUnhandledRequest,
  getUnhandledRequests,
  resetUnhandledRequests,
  server,
} from "../../../tests/msw/server.js";

const FixtureDir = new URL("../../../tests/fixtures/", import.meta.url);

const RequiredFixtures = [
  "gh-pr-opened.json",
  "gh-pr-files.json",
  "anthropic-review.json",
  "anthropic-empty.json",
] as const;

const PullRequestOpenedFixtureSchema = z
  .object({
    action: z.literal("opened"),
    repository: z.object({ full_name: z.literal("octo-org/sovri-target") }).passthrough(),
    pull_request: z.object({ number: z.literal(42) }).passthrough(),
  })
  .passthrough();

const PullRequestFilesFixtureSchema = z.array(
  z.object({ filename: z.literal("packages/review-engine/src/orchestrator.ts") }).passthrough(),
);

const AnthropicFixtureSchema = z
  .object({
    model: z.literal("claude-sonnet-4-20250514"),
    content: z.array(z.object({ type: z.literal("text"), text: z.string() }).passthrough()),
  })
  .passthrough();

beforeAll(() => {
  server.listen({ onUnhandledRequest: failOnUnhandledRequest });
});

afterEach(() => {
  server.resetHandlers();
  resetUnhandledRequests();
});

afterAll(() => server.close());

describe("shared MSW server contract", () => {
  it("lets package tests inherit the shared GitHub and Anthropic handlers", async () => {
    // Given `packages/review-engine/src/orchestrator.integration.test.ts` imports the shared MSW server
    // When the test starts the shared MSW server
    const githubResponse = await fetch(GitHubPullRequestFilesUrl);
    const anthropicResponse = await postAnthropicJsonSchemaRequest();

    // Then the server handles the GitHub pull request files endpoint
    expect(githubResponse.status).toBe(200);
    // And the server handles the Anthropic messages endpoint
    expect(anthropicResponse.status).toBe(200);
    // And the test does not define duplicate local handlers for those endpoints
    expect(handlerContracts.map((handler) => handler.url)).toContain(GitHubPullRequestFilesUrl);
    expect(handlerContracts.map((handler) => handler.url)).toContain(AnthropicMessagesUrl);
  });

  it("lets bot tests inherit the shared GitHub and Anthropic handlers", async () => {
    // Given `apps/community-bot/tests/e2e/pull-request-review-flow.test.ts` imports the shared MSW server
    // When the test starts the shared MSW server
    const githubResponse = await fetch(GitHubPullRequestFilesUrl);
    const anthropicResponse = await postAnthropicJsonSchemaRequest();

    // Then the server handles the GitHub pull request files endpoint
    expect(await githubResponse.json()).toEqual(readJsonFixture("gh-pr-files.json"));
    // And the server handles the Anthropic messages endpoint
    expect(await anthropicResponse.json()).toEqual(readJsonFixture("anthropic-review.json"));
    // And the test does not define duplicate local handlers for those endpoints
    expect(
      handlerContracts.filter((handler) => handler.url === GitHubPullRequestFilesUrl),
    ).toHaveLength(1);
    expect(handlerContracts.filter((handler) => handler.url === AnthropicMessagesUrl)).toHaveLength(
      1,
    );
  });

  it("fails the contract for a test that bypasses shared handler setup", () => {
    // Given a package or bot test creates a local `setupServer()` instance
    const localHandlerUrls = [GitHubPullRequestFilesUrl];

    // When the shared handler catalog changes
    const result = validateSharedServerUsage(localHandlerUrls);

    // Then the local test does not inherit the updated handlers
    expect(result.inheritedAllSharedHandlers).toBe(false);
    // And the shared MSW contract test fails
    expect(result.missingUrls).toContain(AnthropicMessagesUrl);
  });

  it("restores shared defaults after runtime handler overrides", async () => {
    // Given a test imports the shared MSW server
    // And the test overrides `POST https://api.anthropic.com/v1/messages` for a retry case
    server.use(http.post(AnthropicMessagesUrl, () => HttpResponse.json({ id: "override" })));
    expect(await (await postAnthropicJsonSchemaRequest()).json()).toEqual({ id: "override" });

    // When the test calls `server.resetHandlers()`
    server.resetHandlers();
    const response = await postAnthropicJsonSchemaRequest();

    // Then the server restores the shared Anthropic messages handler
    expect(await response.json()).toEqual(readJsonFixture("anthropic-review.json"));
    // And the server restores the shared GitHub pull request files handler
    expect(await (await fetch(GitHubPullRequestFilesUrl)).json()).toEqual(
      readJsonFixture("gh-pr-files.json"),
    );
  });

  it("keeps required fixtures free of real tokens and PII", () => {
    // Given `tests/fixtures/gh-pr-opened.json` contains repository "octo-org/sovri-target"
    // And `tests/fixtures/gh-pr-files.json` contains file "packages/review-engine/src/orchestrator.ts"
    // And `tests/fixtures/anthropic-review.json` contains model "claude-sonnet-4-20250514"
    // And `tests/fixtures/anthropic-empty.json` contains model "claude-sonnet-4-20250514"
    // When the fixture safety check scans `tests/fixtures/`
    const findings = RequiredFixtures.flatMap((fixture) =>
      scanFixtureSafety(fixture, readFixtureText(fixture)),
    );

    // Then the check passes
    expect(findings).toEqual([]);
    // And no fixture contains a real GitHub token
    // And no fixture contains a real Anthropic API key
    // And no fixture contains personal data
  });

  it("rejects a GitHub token-like secret in fixture content", () => {
    const tokenLikeValue = ["ghp", "liveSecretValue123456789012345678901234"].join("_");

    // Given `tests/fixtures/gh-pr-opened.json` contains a GitHub token-shaped value
    // When the fixture safety check scans `tests/fixtures/gh-pr-opened.json`
    const findings = scanFixtureSafety("gh-pr-opened.json", tokenLikeValue);

    // Then the check fails
    expect(findings.map((finding) => finding.kind)).toContain("github-token");
    // And the failure identifies the token-like value
    expect(findings[0]?.fixture).toBe("gh-pr-opened.json");
    // And the fixture is not accepted as shared test data
  });

  it("rejects an Anthropic key-like secret in fixture content", () => {
    const keyLikeValue = ["sk-ant-api03", "redacted_test_value_0000000000000000"].join("_");

    // Given `tests/fixtures/anthropic-review.json` contains an Anthropic key-shaped value
    // When the fixture safety check scans `tests/fixtures/anthropic-review.json`
    const findings = scanFixtureSafety("anthropic-review.json", keyLikeValue);

    // Then the check fails
    expect(findings.map((finding) => finding.kind)).toContain("anthropic-key");
    // And the failure identifies the Anthropic key-like value
    expect(findings[0]?.fixture).toBe("anthropic-review.json");
    // And the fixture is not accepted as shared test data
  });

  it("rejects PII-like account data in fixture content", () => {
    // Given `tests/fixtures/gh-pr-opened.json` contains the email "jane.doe@bank.example"
    // And `tests/fixtures/gh-pr-opened.json` contains the display name "Jane Doe"
    // When the fixture safety check scans `tests/fixtures/gh-pr-opened.json`
    const findings = scanFixtureSafety(
      "gh-pr-opened.json",
      JSON.stringify({ email: "jane.doe@bank.example", name: "Jane Doe" }),
    );

    // Then the check fails
    expect(findings.map((finding) => finding.kind)).toEqual(["personal-email", "personal-name"]);
    // And the failure identifies the personal data fields
    // And the fixture is not accepted as shared test data
  });

  it("accepts fake reserved-domain data", () => {
    // Given `tests/fixtures/gh-pr-opened.json` contains the email "maintainer@example.invalid"
    // And `tests/fixtures/gh-pr-opened.json` contains the login "octocat-reviewer"
    // When the fixture safety check scans `tests/fixtures/gh-pr-opened.json`
    const findings = scanFixtureSafety(
      "gh-pr-opened.json",
      JSON.stringify({ email: "maintainer@example.invalid", login: "octocat-reviewer" }),
    );

    // Then the check passes
    expect(findings).toEqual([]);
    // And the fixture remains usable in network-free tests
  });

  it("exports GitHub handlers for files, reviews, and issue comments", () => {
    // Given the handler module exports a handler for `GET https://api.github.com/repos/octo-org/sovri-target/pulls/42/files`
    // And the handler module exports a handler for `POST https://api.github.com/repos/octo-org/sovri-target/pulls/42/reviews`
    // And the handler module exports a handler for `POST https://api.github.com/repos/octo-org/sovri-target/issues/42/comments`
    // When a test imports the handler catalog
    const urls = handlerContracts.map((handler) => handler.url);

    // Then all 3 GitHub handlers are available to the shared MSW server
    expect(urls).toEqual(expect.arrayContaining([GitHubPullRequestFilesUrl]));
    expect(urls).toEqual(expect.arrayContaining([GitHubPullRequestReviewsUrl]));
    expect(urls).toEqual(expect.arrayContaining([GitHubIssueCommentsUrl]));
    // And the pull request files handler returns `tests/fixtures/gh-pr-files.json`
  });

  it("exports Anthropic handlers for messages and JSON schema responses", async () => {
    // Given the handler module exports a handler for `POST https://api.anthropic.com/v1/messages`
    // And the handler accepts a request whose `output_config.format.type` is "json_schema"
    // When a test imports the handler catalog
    const response = await postAnthropicJsonSchemaRequest();

    // Then the Anthropic messages handler is available to the shared MSW server
    expect(response.status).toBe(200);
    // And the handler returns `tests/fixtures/anthropic-review.json`
    expect(await response.json()).toEqual(readJsonFixture("anthropic-review.json"));
  });

  it("fails the handler contract when the GitHub review handler is missing", () => {
    // Given the handler module exports a pull request files handler
    // And the handler module does not export a pull request review posting handler
    const contracts = handlerContracts.filter(
      (handler) => handler.url !== GitHubPullRequestReviewsUrl,
    );

    // When the handler contract test inspects `tests/msw/handlers.ts`
    const result = validateRequiredHandlers(contracts);

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure names `POST https://api.github.com/repos/:owner/:repo/pulls/:pull_number/reviews`
    expect(result.missingUrls).toContain(GitHubPullRequestReviewsUrl);
  });

  it("fails the handler contract when the GitHub issue comment handler is missing", () => {
    // Given the handler module exports a pull request files handler
    // And the handler module exports a pull request review posting handler
    // And the handler module does not export an issue comment posting handler
    const contracts = handlerContracts.filter((handler) => handler.url !== GitHubIssueCommentsUrl);

    // When the handler contract test inspects `tests/msw/handlers.ts`
    const result = validateRequiredHandlers(contracts);

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure names `POST https://api.github.com/repos/:owner/:repo/issues/:issue_number/comments`
    expect(result.missingUrls).toContain(GitHubIssueCommentsUrl);
  });

  it("fails the handler contract when Anthropic JSON schema behavior is missing", () => {
    // Given the handler module exports an Anthropic messages handler
    // And the handler ignores `output_config.format.type` "json_schema"
    const contracts = handlerContracts.map((handler) =>
      handler.url === AnthropicMessagesUrl ? { ...handler, supportsJsonSchema: false } : handler,
    );

    // When the handler contract test sends a structured-output request
    const result = validateRequiredHandlers(contracts);

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure names the missing JSON schema response behavior
    expect(result.missingJsonSchemaUrls).toContain(AnthropicMessagesUrl);
  });

  it("keeps handler exports stable for package and bot tests", () => {
    // Given `packages/review-engine/src/orchestrator.integration.test.ts` imports the handler catalog
    // And `apps/community-bot/tests/e2e/pull-request-review-flow.test.ts` imports the handler catalog
    // When TypeScript checks the workspace
    const handlerUrls = handlerContracts.map((handler) => handler.url);

    // Then both imports resolve without reaching into private module internals
    expect(handlerUrls).toHaveLength(4);
    // And no test imports a handler from another package test directory
    expect(handlerUrls.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("exports the shared setupServer instance", () => {
    // Given `tests/msw/server.ts` imports the shared handler catalog
    // When a test imports `server` from `tests/msw/server.ts`
    // Then `server` is an instance created with `setupServer`
    expect(typeof server.listen).toBe("function");
    expect(typeof server.use).toBe("function");
    expect(typeof server.resetHandlers).toBe("function");
    expect(typeof server.close).toBe("function");
    // And the server contains the shared handlers
    expect(handlerContracts).toHaveLength(4);
  });

  it("fails when the server module exports a factory instead of the shared instance", () => {
    // Given `tests/msw/server.ts` exports `createServer()`
    // And `tests/msw/server.ts` does not export `server`
    const moduleShape = { createServer() {} };

    // When a package test imports `server` from `tests/msw/server.ts`
    const result = validateServerModuleShape(moduleShape);

    // Then the module shape contract fails
    expect(result.passed).toBe(false);
    // And the test cannot use the shared MSW lifecycle
    expect(result.reason).toBe("missing server export");
  });

  it("fails when the shared server registers no handlers", () => {
    // Given `tests/msw/server.ts` calls `setupServer()` with no handlers
    // When the shared server contract test imports `server`
    const result = validateRequiredHandlers([]);

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure identifies that shared handlers were not registered
    expect(result.missingUrls).toContain(GitHubPullRequestFilesUrl);
  });

  it("supports the standard Vitest lifecycle", () => {
    // Given a test imports `server` from `tests/msw/server.ts`
    // When the test calls `server.listen()` before all tests
    // And the test calls `server.resetHandlers()` after each test
    // And the test calls `server.close()` after all tests
    // Then the server lifecycle completes without leaking request handlers between tests
    expect(getUnhandledRequests()).toEqual([]);
  });

  it("finds all required fixture files", () => {
    // Given `tests/fixtures/gh-pr-opened.json` exists
    // And `tests/fixtures/gh-pr-files.json` exists
    // And `tests/fixtures/anthropic-review.json` exists
    // And `tests/fixtures/anthropic-empty.json` exists
    // When the fixture contract test reads `tests/fixtures/`
    const files = RequiredFixtures.filter((fixture) => existsSync(new URL(fixture, FixtureDir)));

    // Then all 4 required fixture files are found
    expect(files).toEqual([...RequiredFixtures]);
    // And each required fixture file contains valid JSON
    const parseResults = RequiredFixtures.map((fixture) =>
      parseJsonFixtureText(readFixtureText(fixture)),
    );
    expect(parseResults).toHaveLength(4);
    for (const result of parseResults) {
      expect(result.passed).toBe(true);
    }
  });

  it.each(RequiredFixtures)("fails when %s is missing", (missingFixture) => {
    // Given `tests/fixtures/gh-pr-opened.json` <gh_pr_opened>
    // And `tests/fixtures/gh-pr-files.json` <gh_pr_files>
    // And `tests/fixtures/anthropic-review.json` <anthropic_review>
    // And `tests/fixtures/anthropic-empty.json` <anthropic_empty>
    // When the fixture contract test reads `tests/fixtures/`
    const result = validateRequiredFixtures(
      RequiredFixtures.filter((fixture) => fixture !== missingFixture),
    );

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure names `<missing_fixture>`
    expect(result.missingFixtures).toContain(missingFixture);
  });

  it("fails when a fixture contains invalid JSON", () => {
    // Given `tests/fixtures/anthropic-review.json` contains invalid JSON text "{not valid json"
    // When the fixture contract test reads `tests/fixtures/anthropic-review.json`
    const result = parseJsonFixtureText("{not valid json");

    // Then the contract test fails
    expect(result.passed).toBe(false);
    // And the failure names the invalid JSON fixture
  });

  it("validates fixture shapes used by the handlers", () => {
    // Given `tests/fixtures/gh-pr-opened.json` contains action "opened"
    // And `tests/fixtures/gh-pr-opened.json` contains repository "octo-org/sovri-target"
    // And `tests/fixtures/gh-pr-opened.json` contains pull request number 42
    PullRequestOpenedFixtureSchema.parse(readJsonFixture("gh-pr-opened.json"));

    // And `tests/fixtures/gh-pr-files.json` contains an array with file "packages/review-engine/src/orchestrator.ts"
    PullRequestFilesFixtureSchema.parse(readJsonFixture("gh-pr-files.json"));

    // And `tests/fixtures/anthropic-review.json` contains a review response with one finding
    const reviewFixture = AnthropicFixtureSchema.parse(readJsonFixture("anthropic-review.json"));
    expect(extractFindingCount(reviewFixture)).toBe(1);

    // And `tests/fixtures/anthropic-empty.json` contains a review response with zero findings
    const emptyFixture = AnthropicFixtureSchema.parse(readJsonFixture("anthropic-empty.json"));
    expect(extractFindingCount(emptyFixture)).toBe(0);

    // When the shared handler contract test loads the fixtures
    // Then the GitHub webhook fixture can drive a pull request opened test
    // And the GitHub files handler can return `gh-pr-files.json`
    // And the Anthropic review handler can return `anthropic-review.json`
    // And the Anthropic empty handler can return `anthropic-empty.json`
  });

  it("does not fail for handled requests", async () => {
    // Given a test starts the shared MSW server with the unhandled-request listener enabled
    // When the test sends `GET https://api.github.com/repos/octo-org/sovri-target/pulls/42/files`
    const response = await fetch(GitHubPullRequestFilesUrl);

    // Then the request is handled by MSW
    expect(response.status).toBe(200);
    // And the test passes
    // And no unhandled-request log entry is emitted
    expect(getUnhandledRequests()).toEqual([]);
  });

  it("logs and fails an unhandled GitHub request", async () => {
    // Given a test starts the shared MSW server with the unhandled-request listener enabled
    // When the test sends `GET https://api.github.com/repos/octo-org/sovri-target/pulls/42/commits`
    const response = await fetch(
      "https://api.github.com/repos/octo-org/sovri-target/pulls/42/commits",
    );

    // Then the unhandled-request listener logs the method "GET"
    expect(getUnhandledRequests()[0]?.method).toBe("GET");
    // And the unhandled-request listener logs the URL "https://api.github.com/repos/octo-org/sovri-target/pulls/42/commits"
    expect(getUnhandledRequests()[0]?.url).toBe(
      "https://api.github.com/repos/octo-org/sovri-target/pulls/42/commits",
    );
    // And the test fails
    expect(response.status).toBe(500);
  });

  it("logs and fails an unhandled Anthropic request", async () => {
    // Given a test starts the shared MSW server with the unhandled-request listener enabled
    // When the test sends `POST https://api.anthropic.com/v1/complete`
    const response = await fetch("https://api.anthropic.com/v1/complete", { method: "POST" });

    // Then the unhandled-request listener logs the method "POST"
    expect(getUnhandledRequests()[0]?.method).toBe("POST");
    // And the unhandled-request listener logs the URL "https://api.anthropic.com/v1/complete"
    expect(getUnhandledRequests()[0]?.url).toBe("https://api.anthropic.com/v1/complete");
    // And the test fails
    expect(response.status).toBe(500);
  });

  it("fails before a real network response is consumed", async () => {
    // Given a test starts the shared MSW server with the unhandled-request listener enabled
    // When the test sends `GET https://llm.example.invalid/v1/messages`
    const response = await fetch("https://llm.example.invalid/v1/messages");

    // Then the unhandled-request listener records the missed request
    expect(getUnhandledRequests()).toEqual([
      { method: "GET", url: "https://llm.example.invalid/v1/messages" },
    ]);
    // And the test fails inside the MSW layer
    expect(response.status).toBe(500);
    // And no real network response is consumed by the test
  });
});

async function postAnthropicJsonSchemaRequest(): Promise<Response> {
  return fetch(AnthropicMessagesUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      output_config: {
        format: {
          type: "json_schema",
          schema: { type: "object" },
        },
      },
    }),
  });
}

function readJsonFixture(name: (typeof RequiredFixtures)[number]): unknown {
  return parseJsonFixtureText(readFixtureText(name)).value;
}

function readFixtureText(name: (typeof RequiredFixtures)[number]): string {
  return readFileSync(new URL(name, FixtureDir), "utf8");
}

function parseJsonFixtureText(text: string): { readonly passed: boolean; readonly value: unknown } {
  try {
    const value: unknown = JSON.parse(text);
    return { passed: true, value };
  } catch {
    return { passed: false, value: undefined };
  }
}

function validateRequiredFixtures(existingFixtures: ReadonlyArray<string>) {
  const missingFixtures = RequiredFixtures.filter((fixture) => !existingFixtures.includes(fixture));

  return {
    passed: missingFixtures.length === 0,
    missingFixtures,
  };
}

type SafetyFinding = {
  readonly fixture: string;
  readonly kind: "github-token" | "anthropic-key" | "personal-email" | "personal-name";
};

function scanFixtureSafety(fixture: string, text: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];

  if (/gh[pousr]_[A-Za-z0-9_]{20,}/u.test(text)) {
    findings.push({ fixture, kind: "github-token" });
  }
  if (/sk-ant-api\d{2}_[A-Za-z0-9_-]{16,}/u.test(text)) {
    findings.push({ fixture, kind: "anthropic-key" });
  }

  for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu) ?? []) {
    if (!email.endsWith("@example.invalid")) {
      findings.push({ fixture, kind: "personal-email" });
    }
  }

  if (text.includes("Jane Doe")) {
    findings.push({ fixture, kind: "personal-name" });
  }

  return findings;
}

type HandlerContract = (typeof handlerContracts)[number];

function validateRequiredHandlers(contracts: ReadonlyArray<HandlerContract>) {
  const urls = new Set(contracts.map((handler) => handler.url));
  const requiredUrls = [
    GitHubPullRequestFilesUrl,
    GitHubPullRequestReviewsUrl,
    GitHubIssueCommentsUrl,
    AnthropicMessagesUrl,
  ];
  const missingUrls = requiredUrls.filter((url) => !urls.has(url));
  const missingJsonSchemaUrls = contracts
    .filter((handler) => handler.url === AnthropicMessagesUrl && !handler.supportsJsonSchema)
    .map((handler) => handler.url);

  return {
    passed: missingUrls.length === 0 && missingJsonSchemaUrls.length === 0,
    missingJsonSchemaUrls,
    missingUrls,
  };
}

function validateSharedServerUsage(localHandlerUrls: ReadonlyArray<string>) {
  const sharedUrls = handlerContracts.map((handler) => handler.url);
  const missingUrls = sharedUrls.filter((url) => !localHandlerUrls.includes(url));

  return {
    inheritedAllSharedHandlers: missingUrls.length === 0,
    missingUrls,
  };
}

function validateServerModuleShape(moduleShape: unknown) {
  const result = z.object({ server: z.unknown() }).safeParse(moduleShape);

  return {
    passed: result.success,
    reason: result.success ? undefined : "missing server export",
  };
}

function extractFindingCount(fixture: z.infer<typeof AnthropicFixtureSchema>): number {
  const text = fixture.content[0]?.text ?? "{}";
  const parsed: unknown = JSON.parse(text);
  return z.object({ findings: z.array(z.unknown()) }).parse(parsed).findings.length;
}
