// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import {
  registerWebhookHandlers,
  type IssueCommentRegistrarContext,
} from "../../src/handlers/index.js";
import type {
  IssueCommentHandlerDependencies,
  IssueCommentWebhookContext,
} from "../../src/handlers/issue-comment.js";
import type { PullRequestHandlerDependencies } from "../../src/handlers/pull-request.js";

const DELIVERY_ID = "delivery-issue-comment-registration-001";
const REPO_FULL_NAME = "octo-org/sovri-target";
const PULL_REQUEST_NUMBER = 73;
const COMMENT_ID = 12_345;

describe("issue comment webhook registration", () => {
  it("registers issue_comment.created and routes re-review through the dispatcher", async () => {
    const handlers = new Map<string, (context: IssueCommentRegistrarContext) => Promise<void>>();
    const dependencies = buildDependencies();
    const app = {
      on(
        eventName: "issue_comment.created" | "pull_request.opened" | "pull_request.synchronize",
        handler: (context: never) => Promise<void>,
      ): void {
        handlers.set(
          eventName,
          handler as unknown as (context: IssueCommentRegistrarContext) => Promise<void>,
        );
      },
    };

    // Given the runtime webhook registrar is configured
    registerWebhookHandlers(
      app,
      () => ({}) as unknown as PullRequestHandlerDependencies,
      () => dependencies,
    );

    const issueCommentHandler = handlers.get("issue_comment.created");
    if (issueCommentHandler === undefined) {
      throw new Error("issue_comment.created webhook handler was not registered");
    }

    // When Probot dispatches an issue_comment.created webhook with a re-review command
    await issueCommentHandler(
      buildContext({
        author: "alice",
        body: "@sovri-bot re-review",
        deliveryId: DELIVERY_ID,
        pullRequestNumber: PULL_REQUEST_NUMBER,
        repoFullName: REPO_FULL_NAME,
      }),
    );

    // Then the dispatcher routes through the re-review dependency
    expect(dependencies.handleReReview).toHaveBeenCalledTimes(1);
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.correlationId).toBe(DELIVERY_ID);
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.pullRequestNumber).toBe(
      PULL_REQUEST_NUMBER,
    );
    expect(dependencies.handleReReview.mock.calls[0]?.[0]?.commentId).toBe(COMMENT_ID);
  });
});

function buildDependencies(): IssueCommentHandlerDependencies & {
  readonly handleDismiss: ReturnType<
    typeof vi.fn<IssueCommentHandlerDependencies["handleDismiss"]>
  >;
  readonly handleReReview: ReturnType<
    typeof vi.fn<IssueCommentHandlerDependencies["handleReReview"]>
  >;
  readonly parseCommand: ReturnType<typeof vi.fn<IssueCommentHandlerDependencies["parseCommand"]>>;
  readonly reactToUnknown: ReturnType<
    typeof vi.fn<IssueCommentHandlerDependencies["reactToUnknown"]>
  >;
} {
  return {
    botLogin: "sovri-bot[bot]",
    handleDismiss: vi.fn<IssueCommentHandlerDependencies["handleDismiss"]>(async () => undefined),
    handleReReview: vi.fn<IssueCommentHandlerDependencies["handleReReview"]>(async () => undefined),
    parseCommand: vi.fn<IssueCommentHandlerDependencies["parseCommand"]>(() => ({
      kind: "re-review",
    })),
    reactToUnknown: vi.fn<IssueCommentHandlerDependencies["reactToUnknown"]>(async () => undefined),
  };
}

function buildContext(values: {
  readonly author: string;
  readonly body: string;
  readonly deliveryId: string;
  readonly pullRequestNumber: number;
  readonly repoFullName: string;
}): IssueCommentRegistrarContext {
  const context: IssueCommentWebhookContext & {
    readonly octokit: IssueCommentRegistrarContext["octokit"];
  } = {
    id: values.deliveryId,
    name: "issue_comment.created",
    octokit: {
      rest: {
        reactions: {
          createForIssueComment: vi.fn(async () => ({ data: {} })),
        },
      },
    },
    payload: {
      comment: {
        body: values.body,
        id: COMMENT_ID,
        user: {
          login: values.author,
        },
      },
      issue: {
        number: values.pullRequestNumber,
        pull_request: {},
      },
      repository: {
        full_name: values.repoFullName,
      },
    },
  };
  return context;
}
