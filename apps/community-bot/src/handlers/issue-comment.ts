// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ParsedCommand } from "../commands/parser.js";

export type IssueCommentWebhookContext = {
  readonly id: string;
  readonly name: string;
  readonly payload: {
    readonly comment: {
      readonly body?: string;
      readonly id?: number;
      readonly user?: {
        readonly login?: string;
      } | null;
    };
    readonly issue: {
      readonly number?: number;
      readonly pull_request?: unknown;
    };
    readonly repository: {
      readonly full_name?: string;
    };
  };
};

export type IssueCommentCommandContext = {
  readonly commentId: number;
  readonly correlationId: string;
  readonly issueNumber: number;
  readonly pullRequestNumber: number;
  readonly repoFullName: string;
};

export type IssueCommentDismissCommandContext = IssueCommentCommandContext & {
  readonly commentAuthorLogin: string;
  readonly findingId: string;
};

export type IssueCommentUnknownReaction = {
  readonly commentId: number;
  readonly content: "confused";
};

export type IssueCommentHandlerDependencies = {
  readonly botLogin: string;
  readonly handleDismiss: (context: IssueCommentDismissCommandContext) => Promise<void>;
  readonly handleReReview: (context: IssueCommentCommandContext) => Promise<void>;
  readonly parseCommand: (body: string) => ParsedCommand;
  readonly reactToUnknown: (reaction: IssueCommentUnknownReaction) => Promise<void>;
};

export async function handleIssueCommentCreated(
  context: IssueCommentWebhookContext,
  dependencies: IssueCommentHandlerDependencies,
): Promise<void> {
  if (context.payload.issue.pull_request === undefined) {
    return;
  }

  if (context.payload.comment.user?.login === dependencies.botLogin) {
    return;
  }

  const command = dependencies.parseCommand(
    requireString(context.payload.comment.body, "comment.body"),
  );

  if (command.kind === "no-mention") {
    return;
  }

  if (command.kind === "unknown") {
    await dependencies.reactToUnknown({
      commentId: requireNumber(context.payload.comment.id, "comment.id"),
      content: "confused",
    });
    return;
  }

  const commandContext = buildCommandContext(context);

  if (command.kind === "re-review") {
    await dependencies.handleReReview(commandContext);
    return;
  }

  if (command.kind === "dismiss") {
    await dependencies.handleDismiss({
      ...commandContext,
      commentAuthorLogin: requireString(context.payload.comment.user?.login, "comment.user.login"),
      findingId: command.findingId,
    });
  }
}

function buildCommandContext(context: IssueCommentWebhookContext): IssueCommentCommandContext {
  const issueNumber = requireNumber(context.payload.issue.number, "issue.number");
  return {
    commentId: requireNumber(context.payload.comment.id, "comment.id"),
    correlationId: context.id,
    issueNumber,
    pullRequestNumber: issueNumber,
    repoFullName: requireString(context.payload.repository.full_name, "repository.full_name"),
  };
}

function requireNumber(value: number | undefined, path: string): number {
  if (value === undefined) {
    throw new IssueCommentPayloadError(path);
  }

  return value;
}

function requireString(value: string | undefined, path: string): string {
  if (value === undefined || value.length === 0) {
    throw new IssueCommentPayloadError(path);
  }

  return value;
}

class IssueCommentPayloadError extends Error {
  public override readonly name = "IssueCommentPayloadError";

  public constructor(path: string) {
    super(`Missing issue comment payload field: ${path}`);
  }
}
