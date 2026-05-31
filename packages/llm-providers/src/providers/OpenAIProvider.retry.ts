// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
} from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  Completions,
} from "openai/resources/chat/completions";

import {
  retryWithBackoff,
  RetryExhaustedError,
  RetryTimeoutError,
  type AttemptContext,
} from "../helpers/retry.js";
import {
  OpenAIProviderAuthError,
  OpenAIProviderError,
  type OpenAIProviderErrorOptions,
} from "./OpenAIProvider.errors.js";

const OPENAI_RETRY_BASE_DELAY_MS = 500;

export type OpenAIChatComplete = Completions["create"];
export type OpenAIChatRequest = ChatCompletionCreateParamsNonStreaming;
export type OpenAIChatOptions = Parameters<OpenAIChatComplete>[1];

export interface OpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: OpenAIChatComplete;
    };
  };
}

export async function createOpenAIChatCompletionWithRetry(options: {
  readonly client: OpenAIChatClient;
  readonly request: OpenAIChatRequest;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
}): Promise<unknown> {
  try {
    return await retryWithBackoff(
      async (ctx) =>
        options.client.chat.completions.create(options.request, createOpenAIRequestOptions(ctx)),
      {
        maxAttempts: options.maxAttempts,
        baseDelayMs: OPENAI_RETRY_BASE_DELAY_MS,
        timeoutMs: options.timeoutMs,
        isRetryable: isRetryableOpenAIError,
      },
    );
  } catch (cause) {
    throw createOpenAIRequestError(cause, options.maxAttempts, options.timeoutMs);
  }
}

function createOpenAIRequestOptions(ctx: AttemptContext): OpenAIChatOptions {
  return {
    maxRetries: 0,
    signal: ctx.signal,
    timeout: ctx.timeoutMs,
  };
}

function createOpenAIRequestError(
  cause: unknown,
  maxAttempts: number,
  timeoutMs: number,
): OpenAIProviderError<"OpenAIProviderError" | "OpenAIProviderAuthError"> {
  if (cause instanceof RetryExhaustedError) {
    return new OpenAIProviderError(
      `OpenAI failed after ${String(maxAttempts)} attempts`,
      openAIRequestErrorOptions(cause.cause),
    );
  }

  if (cause instanceof RetryTimeoutError) {
    return new OpenAIProviderError(
      `OpenAI request timed out after ${String(timeoutMs)} ms`,
      openAIRequestErrorOptions(cause.cause),
    );
  }

  const options = openAIRequestErrorOptions(cause);

  if (isOpenAIAuthFailure(cause)) {
    return new OpenAIProviderAuthError("OpenAI request failed authentication", options);
  }

  return new OpenAIProviderError(openAIRequestErrorMessage(cause), options);
}

function openAIRequestErrorOptions(cause: unknown): OpenAIProviderErrorOptions {
  if (!(cause instanceof APIError)) {
    return { cause };
  }

  return {
    cause,
    ...(cause.status !== undefined ? { status: cause.status } : {}),
    ...(cause.requestID !== undefined ? { requestId: cause.requestID } : {}),
    ...(cause.code !== undefined ? { code: cause.code } : {}),
  };
}

function openAIRequestErrorMessage(cause: unknown): string {
  if (cause instanceof APIError && cause.status !== undefined) {
    return `OpenAI request failed with status ${String(cause.status)}`;
  }

  return "OpenAI request failed";
}

function isOpenAIAuthFailure(cause: unknown): boolean {
  return cause instanceof AuthenticationError || cause instanceof PermissionDeniedError;
}

function isRetryableOpenAIError(cause: unknown): boolean {
  if (cause instanceof APIConnectionError || cause instanceof APIConnectionTimeoutError) {
    return true;
  }
  if (!(cause instanceof APIError) || cause.status === undefined) {
    return false;
  }

  return (
    cause.status === 408 || cause.status === 409 || cause.status === 429 || cause.status >= 500
  );
}
