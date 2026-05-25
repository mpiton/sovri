// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  createIssueCommentHandlerDependencies,
  type IssueCommentDispatchContext,
} from "../github/issue-comment-dispatcher.js";
import { createPullRequestHandlerDependencies } from "../github/pull-request-review.js";
import {
  handleIssueCommentCreated,
  type IssueCommentHandlerDependencies,
  type IssueCommentWebhookContext,
} from "./issue-comment.js";
import {
  handlePullRequestOpened,
  handlePullRequestSynchronize,
  type PullRequestHandlerDependencies,
  type PullRequestWebhookContext,
} from "./pull-request.js";

type PullRequestEventName = "pull_request.opened" | "pull_request.synchronize";
type PullRequestWebhookHandler = (context: PullRequestWebhookContext) => Promise<void>;
type PullRequestDependencyFactory = (
  context: PullRequestWebhookContext,
) => PullRequestHandlerDependencies;

type IssueCommentEventName = "issue_comment.created";
export type IssueCommentRegistrarContext = IssueCommentWebhookContext & IssueCommentDispatchContext;
type IssueCommentWebhookHandler = (context: IssueCommentRegistrarContext) => Promise<void>;
type IssueCommentDependencyFactory = (
  context: IssueCommentRegistrarContext,
) => IssueCommentHandlerDependencies;

export type PullRequestWebhookRegistrar = {
  readonly on: (eventName: PullRequestEventName, handler: PullRequestWebhookHandler) => void;
};

export type IssueCommentWebhookRegistrar = {
  readonly on: (eventName: IssueCommentEventName, handler: IssueCommentWebhookHandler) => void;
};

export type WebhookRegistrar = PullRequestWebhookRegistrar & IssueCommentWebhookRegistrar;

export function registerWebhookHandlers(
  app: WebhookRegistrar,
  createPullRequestDependencies: PullRequestDependencyFactory = createPullRequestHandlerDependencies,
  createIssueCommentDependencies: IssueCommentDependencyFactory = createIssueCommentHandlerDependencies,
): void {
  app.on("pull_request.opened", async (context) => {
    await handlePullRequestOpened(context, createPullRequestDependencies(context));
  });

  app.on("pull_request.synchronize", async (context) => {
    await handlePullRequestSynchronize(context, createPullRequestDependencies(context));
  });

  app.on("issue_comment.created", async (context) => {
    await handleIssueCommentCreated(context, createIssueCommentDependencies(context));
  });
}
