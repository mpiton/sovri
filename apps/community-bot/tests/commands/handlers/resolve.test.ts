// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createIssueCommentHandlerDependencies } from "../../../src/github/issue-comment-dispatcher.js";
import { handleIssueCommentCreated } from "../../../src/handlers/issue-comment.js";

const DeliveryId = "delivery-resolve-thread-001";
const AuthzFailureDeliveryId = "delivery-resolve-authz-001";
const FailureDeliveryId = "delivery-resolve-failure-001";
const SafetyDeliveryId = "delivery-resolve-safety-001";
const RepoFullName = "octo-org/sovri-target";
const PullRequestNumber = 42;
const CommentId = 98_765;
const ReviewCommentId = 501;
const ReviewCommentNodeId = "PRRC_thread_001";
const ThreadId = "PRRT_thread_001";
const KnownFindingId = "finding-thread-001";
const SecretGitHubToken = "github-token-placeholder-for-log-safety";
const SecretLlmApiKey = "llm-api-key-placeholder-for-log-safety";
const ResolveHandlerSourceUrl = new URL(
  "../../../src/commands/handlers/resolve.ts",
  import.meta.url,
);
const KnownInlineCommentBody = [
  "**Missing null guard**",
  "",
  "Add a guard before reading payload.user.",
  `<!-- sovri-finding-id: ${KnownFindingId} -->`,
].join("\n");

// Exercises the resolve command as a GitHub adapter workflow: author gating,
// finding lookup, thread resolution/fallback, idempotency, and surfaced failures.
describe("resolve command handler", () => {
  it("resolves the matching bot review thread and acknowledges the command", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "octo-org",
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).toHaveBeenCalledWith({
      owner: "octo-org",
      page: 1,
      per_page: 100,
      pull_number: PullRequestNumber,
      repo: "sovri-target",
    });
    expect(runtime.graphqlCalls.some((call) => call.query.includes("resolveReviewThread"))).toBe(
      true,
    );
    expect(runtime.graphqlCalls).toContainEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ threadId: ThreadId }),
      }),
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.pulls.updateReview).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("logs successful resolve without emitting a failure", async () => {
    const runtime = buildRuntime();
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: FailureDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledTimes(1);
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_id: FailureDeliveryId }),
      "Resolve command started",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_id: FailureDeliveryId, result: "success" }),
      "Resolve command completed",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not resolve a finding when the commenter is not the pull request author", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      commentAuthorLogin: "mallory",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Only the pull request author can resolve findings.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("logs and surfaces pull request author lookup failures without crashing", async () => {
    const runtime = buildRuntime({
      authorLookupError: hardGitHubError(500),
    });
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: AuthzFailureDeliveryId,
      findingId: "finding-authz-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: AuthzFailureDeliveryId,
        github_status: 500,
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Resolve command failed",
    );
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Resolve command could not be completed. Please retry later.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.pulls.listReviewComments).not.toHaveBeenCalled();
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: "review comment listing",
      options: { reviewCommentListingError: hardGitHubError(502) },
      status: 502,
    },
    {
      operation: "reaction creation",
      options: { acceptedIssueReactionError: hardGitHubError(422) },
      status: 422,
    },
  ])(
    "logs and surfaces hard GitHub failures during $operation without crashing",
    async ({ options, status }) => {
      const runtime = buildRuntime(options);
      const logger = buildLogger();
      const context = buildIssueCommentContext(runtime.octokit, {
        deliveryId: FailureDeliveryId,
      });
      const dependencies = createIssueCommentHandlerDependencies(
        context,
        { SOVRI_BOT_LOGIN: "sovri-bot" },
        logger,
      );

      await handleIssueCommentCreated(context, dependencies);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          delivery_id: FailureDeliveryId,
          github_status: status,
          pr_number: PullRequestNumber,
          repo: RepoFullName,
        }),
        "Resolve command failed",
      );
      expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
        body: "Resolve command could not be completed. Please retry later.",
        issue_number: PullRequestNumber,
        owner: "octo-org",
        repo: "sovri-target",
      });
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ delivery_id: FailureDeliveryId, result: "success" }),
        "Resolve command completed",
      );
    },
  );

  it("posts a not-found message without changing state for an unknown finding id", async () => {
    const runtime = buildRuntime();
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "missing-finding-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Finding missing-finding-001 was not found, so nothing changed.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("ignores human-authored comments with matching finding marker text", async () => {
    const runtime = buildRuntime();
    runtime.octokit.rest.pulls.listReviewComments.mockResolvedValueOnce({
      data: [
        {
          body: ["Human note", "", "<!-- sovri-finding-id: missing-finding-001 -->"].join("\n"),
          id: ReviewCommentId,
          node_id: ReviewCommentNodeId,
          user: { login: "alice" },
        },
      ],
    });
    const context = buildIssueCommentContext(runtime.octokit, {
      findingId: "missing-finding-001",
    });
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Finding missing-finding-001 was not found, so nothing changed.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.graphql).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("keeps resolve stateless without persistent suppression stores", () => {
    const source = readFileSync(ResolveHandlerSourceUrl, "utf8");
    const resolveCommandSource = extractResolveCommandSource(source);

    expect(resolveCommandSource).toContain("resolveReviewThread");
    expect(resolveCommandSource).toContain("minimizeResolvedComment");
    expect(resolveCommandSource).not.toMatch(
      /addLabels|updateComment|updateReview|listComments|DISMISSED_FINDING_LABEL/u,
    );
    expect(resolveCommandSource).not.toMatch(
      /database|postgres|sqlite|prisma|redis|cache|queue|persistent|scheduler|setInterval|setTimeout|suppression|timer/iu,
    );
  });

  it("keeps the resolve handler source under the Community license header", () => {
    const source = readFileSync(ResolveHandlerSourceUrl, "utf8");

    expect(source.startsWith("// Copyright 2026 Sovri contributors\n")).toBe(true);
    expect(source).toContain("// SPDX-License-Identifier: Apache-2.0");
  });

  it("includes reachable arrow-function helpers in the stateless source graph", () => {
    const source = [
      "async function handleResolveCommand() {",
      "  await markResolved();",
      "}",
      "const markResolved = async (): Promise<void> => {",
      "  await prisma.suppression.create();",
      "};",
    ].join("\n");

    expect(extractResolveCommandSource(source)).toContain("prisma.suppression.create");
  });

  it("falls back to minimizing the review comment when no thread id is available", async () => {
    const runtime = buildRuntime({ thread: "missing" });
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.graphqlCalls.some((call) => call.query.includes("minimizeComment"))).toBe(true);
    expect(runtime.graphqlCalls).toContainEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ subjectId: ReviewCommentNodeId }),
      }),
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("acknowledges an already-resolved thread without resolving it again", async () => {
    const runtime = buildRuntime({ thread: "resolved" });
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.graphqlCalls.some((call) => call.query.includes("resolveReviewThread"))).toBe(
      false,
    );
    expect(runtime.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      content: "+1",
      owner: "octo-org",
      repo: "sovri-target",
    });
  });

  it("does not duplicate an existing accepted issue-comment reaction", async () => {
    const runtime = buildRuntime({
      issueCommentReactions: [{ content: "+1", user: { login: "sovri-bot" } }],
      thread: "resolved",
    });
    const context = buildIssueCommentContext(runtime.octokit);
    const dependencies = createIssueCommentHandlerDependencies(context, {
      SOVRI_BOT_LOGIN: "sovri-bot",
    });

    await handleIssueCommentCreated(context, dependencies);

    expect(runtime.octokit.rest.reactions.listForIssueComment).toHaveBeenCalledWith({
      comment_id: CommentId,
      owner: "octo-org",
      page: 1,
      per_page: 100,
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(runtime.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("logs and surfaces hard resolve failures without crashing the webhook", async () => {
    const runtime = buildRuntime({
      resolveError: hardGitHubError(503),
    });
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: FailureDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_id: FailureDeliveryId,
        github_status: 503,
        pr_number: PullRequestNumber,
        repo: RepoFullName,
      }),
      "Resolve command failed",
    );
    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Resolve command could not be completed. Please retry later.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  it("logs resolve failures without raw payloads or secrets", async () => {
    const runtime = buildRuntime({
      resolveError: hardGitHubError(503),
    });
    const logger = buildLogger();
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: SafetyDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      {
        ANTHROPIC_API_KEY: SecretLlmApiKey,
        GITHUB_TOKEN: SecretGitHubToken,
        SOVRI_BOT_LOGIN: "sovri-bot",
      },
      logger,
    );

    await handleIssueCommentCreated(context, dependencies);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const errorCall = logger.error.mock.calls.at(0);
    if (errorCall === undefined) {
      throw new Error("Resolve failure log was not emitted");
    }
    const [bindings, message] = errorCall;
    expect(message).toBe("Resolve command failed");
    expect(bindings).toStrictEqual({
      delivery_id: SafetyDeliveryId,
      github_status: 503,
      pr_number: PullRequestNumber,
      repo: RepoFullName,
    });
    const serializedBindings = JSON.stringify(bindings);
    expect(serializedBindings).not.toContain("payload");
    expect(serializedBindings).not.toContain("comment");
    expect(serializedBindings).not.toContain(SecretGitHubToken);
    expect(serializedBindings).not.toContain(SecretLlmApiKey);
  });

  it("keeps thread-resolution failures stateless inside the webhook request", async () => {
    const runtime = buildRuntime({
      resolveError: hardGitHubError(503),
    });
    const logger = buildLogger();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const context = buildIssueCommentContext(runtime.octokit, {
      deliveryId: FailureDeliveryId,
    });
    const dependencies = createIssueCommentHandlerDependencies(
      context,
      { SOVRI_BOT_LOGIN: "sovri-bot" },
      logger,
    );

    try {
      await handleIssueCommentCreated(context, dependencies);

      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    }

    expect(runtime.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Resolve command could not be completed. Please retry later.",
      issue_number: PullRequestNumber,
      owner: "octo-org",
      repo: "sovri-target",
    });
    expect(runtime.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });
});

type ReviewThreadMode = "missing" | "open" | "resolved";

type RuntimeOptions = {
  readonly acceptedIssueReactionError?: unknown;
  readonly authorLookupError?: unknown;
  readonly issueCommentReactions?: readonly IssueCommentReactionFixture[];
  readonly reviewCommentListingError?: unknown;
  readonly resolveError?: unknown;
  readonly thread?: ReviewThreadMode;
};

type IssueCommentReactionFixture = {
  readonly content: "+1" | "confused";
  readonly user?: {
    readonly login?: string;
  } | null;
};

type GraphqlCall = {
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

function buildRuntime(options: RuntimeOptions = {}) {
  const thread = options.thread ?? "open";
  const graphqlCalls: GraphqlCall[] = [];
  const octokit = {
    graphql: vi.fn(async (query: string, variables: Readonly<Record<string, unknown>>) => {
      graphqlCalls.push({ query, variables });
      if (query.includes("resolveReviewThread")) {
        if (options.resolveError !== undefined) {
          throw options.resolveError;
        }
        return { resolveReviewThread: { thread: { isResolved: true } } };
      }
      if (query.includes("minimizeComment")) {
        return { minimizeComment: { minimizedComment: { isMinimized: true } } };
      }
      return resolveReviewThreadsResponse(thread);
    }),
    rest: {
      issues: {
        addLabels: vi.fn(async () => ({ data: {} })),
        createComment: vi.fn(async () => ({ data: { id: 7001 } })),
        listComments: vi.fn(async () => ({ data: [] })),
        updateComment: vi.fn(async () => ({ data: { id: 7000 } })),
      },
      pulls: {
        createReview: vi.fn(async () => ({ data: { id: 6000 } })),
        createReviewComment: vi.fn(async () => ({ data: { id: 8000 } })),
        get: vi.fn(async () => {
          if (options.authorLookupError !== undefined) {
            throw options.authorLookupError;
          }
          return { data: { user: { login: "alice" } } };
        }),
        listReviewComments: vi.fn(async () => {
          if (options.reviewCommentListingError !== undefined) {
            throw options.reviewCommentListingError;
          }

          return {
            data: [
              {
                body: KnownInlineCommentBody,
                id: ReviewCommentId,
                node_id: ReviewCommentNodeId,
                user: { login: "sovri-bot" },
              },
            ],
          };
        }),
        listReviews: vi.fn(async () => ({ data: [] })),
        updateReview: vi.fn(async () => ({ data: { id: 6000 } })),
      },
      reactions: {
        createForIssueComment: vi.fn(async () => {
          if (options.acceptedIssueReactionError !== undefined) {
            throw options.acceptedIssueReactionError;
          }

          return { data: {} };
        }),
        createForPullRequestReviewComment: vi.fn(async () => ({ data: {} })),
        listForIssueComment: vi.fn(async () => ({ data: options.issueCommentReactions ?? [] })),
        listForPullRequestReviewComment: vi.fn(async () => ({ data: [] })),
      },
    },
  };

  return { graphqlCalls, octokit };
}

function extractResolveCommandSource(source: string): string {
  return extractReachableFunctionSources(source, "handleResolveCommand").join("\n");
}

function extractReachableFunctionSources(
  source: string,
  entryFunctionName: string,
): readonly string[] {
  const functionsByName = collectLocalFunctionSources(source);
  const queue = [entryFunctionName];
  const visited = new Set<string>();
  const reachableSources: string[] = [];

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const functionName = queue[queueIndex];
    if (functionName === undefined || visited.has(functionName)) {
      continue;
    }

    const functionSource = functionsByName.get(functionName);
    if (functionSource === undefined) {
      if (functionName === entryFunctionName) {
        throw new Error(`resolve command entry ${entryFunctionName} source could not be located`);
      }
      continue;
    }

    visited.add(functionName);
    reachableSources.push(functionSource);

    for (const candidateName of functionsByName.keys()) {
      if (!visited.has(candidateName) && callsLocalFunction(functionSource, candidateName)) {
        queue.push(candidateName);
      }
    }
  }

  return reachableSources;
}

function collectLocalFunctionSources(source: string): ReadonlyMap<string, string> {
  const functionsByName = new Map<string, string>();
  const functionDeclarationPattern = /\bfunction\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/gu;
  const arrowFunctionPattern =
    /\bconst\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{/gu;

  for (const match of source.matchAll(functionDeclarationPattern)) {
    const functionName = match[1];
    if (functionName === undefined || match.index === undefined) {
      continue;
    }

    functionsByName.set(functionName, extractFunctionSourceAt(source, functionName, match.index));
  }

  for (const match of source.matchAll(arrowFunctionPattern)) {
    const functionName = match[1];
    if (functionName === undefined || match.index === undefined) {
      continue;
    }

    functionsByName.set(functionName, extractFunctionSourceAt(source, functionName, match.index));
  }

  return functionsByName;
}

function extractFunctionSourceAt(
  source: string,
  functionName: string,
  functionStart: number,
): string {
  const start = readAsyncFunctionStart(source, functionStart);
  const openingBrace = source.indexOf("{", functionStart);
  if (openingBrace === -1) {
    throw new Error(`resolve command helper ${functionName} body could not be located`);
  }

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "{") {
      depth += 1;
    }
    if (character === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  throw new Error(`resolve command helper ${functionName} body end could not be located`);
}

function callsLocalFunction(source: string, functionName: string): boolean {
  const callPattern = new RegExp(`\\b${functionName}\\s*\\(`, "u");
  return callPattern.test(source);
}

function readAsyncFunctionStart(source: string, functionStart: number): number {
  const asyncPrefix = "async ";
  const asyncStart = functionStart - asyncPrefix.length;
  if (asyncStart >= 0 && source.slice(asyncStart, functionStart) === asyncPrefix) {
    return asyncStart;
  }

  return functionStart;
}

function resolveReviewThreadsResponse(mode: ReviewThreadMode): unknown {
  const nodes =
    mode === "missing"
      ? []
      : [
          {
            comments: {
              nodes: [
                {
                  author: { login: "sovri-bot" },
                  body: KnownInlineCommentBody,
                },
              ],
            },
            id: ThreadId,
            isResolved: mode === "resolved",
          },
        ];
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes,
          pageInfo: {
            endCursor: null,
            hasNextPage: false,
          },
        },
      },
    },
  };
}

function buildLogger() {
  return {
    error: vi.fn<(bindings: Readonly<Record<string, unknown>>, message: string) => void>(
      () => undefined,
    ),
    info: vi.fn<(bindings: Readonly<Record<string, unknown>>, message: string) => void>(
      () => undefined,
    ),
  };
}

function hardGitHubError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error(`GitHub ${status}`), { status });
}

function buildIssueCommentContext(
  octokit: ReturnType<typeof buildRuntime>["octokit"],
  options: {
    readonly commentAuthorLogin?: string;
    readonly deliveryId?: string;
    readonly findingId?: string;
  } = {},
) {
  const findingId = options.findingId ?? KnownFindingId;
  return {
    id: options.deliveryId ?? DeliveryId,
    name: "issue_comment.created",
    octokit,
    payload: {
      comment: {
        body: `@sovri-bot resolve ${findingId}`,
        id: CommentId,
        user: {
          login: options.commentAuthorLogin ?? "alice",
        },
      },
      issue: {
        number: PullRequestNumber,
        pull_request: {
          user: {
            login: "alice",
          },
        },
      },
      repository: {
        full_name: RepoFullName,
      },
    },
  };
}
