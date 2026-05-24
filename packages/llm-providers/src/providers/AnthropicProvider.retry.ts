// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
} from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

import {
  AnthropicAuthError,
  AnthropicResponseError,
  AnthropicRetryError,
  AnthropicTimeoutError,
} from "../errors.js";
import {
  retryWithBackoff,
  RetryExhaustedError,
  RetryTimeoutError,
  type AttemptContext,
} from "../helpers/retry.js";

export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60_000;

const STRUCTURED_OUTPUTS_BETA_HEADER = "structured-outputs-2025-11-13";
const ANTHROPIC_MAX_TOTAL_ATTEMPTS = 3;
const ANTHROPIC_RETRY_BASE_DELAY_MS = 500;

interface AnthropicCreateOptions {
  readonly headers: Record<string, string>;
  readonly maxRetries: number;
  readonly signal: AbortSignal;
  readonly timeout: number;
}

export interface AnthropicMessagesClient {
  readonly messages: {
    create(
      request: MessageCreateParamsNonStreaming,
      options: AnthropicCreateOptions,
    ): Promise<unknown>;
  };
}

export async function createAnthropicMessageWithRetry(options: {
  readonly client: AnthropicMessagesClient;
  readonly request: MessageCreateParamsNonStreaming;
  readonly timeoutMs: number;
}): Promise<unknown> {
  const attemptDurationsMs: number[] = [];

  try {
    return await retryWithBackoff(
      async (ctx: AttemptContext) => {
        const startedAt = Date.now();
        try {
          return await options.client.messages.create(options.request, {
            headers: { "anthropic-beta": STRUCTURED_OUTPUTS_BETA_HEADER },
            maxRetries: 0,
            signal: ctx.signal,
            timeout: ctx.timeoutMs,
          });
        } catch (cause) {
          attemptDurationsMs.push(Date.now() - startedAt);
          if (isAnthropicTimeoutError(cause)) {
            throw new AnthropicTimeoutError(
              `Anthropic request timed out after ${String(options.timeoutMs)} ms`,
              { cause, attemptDurationsMs: [...attemptDurationsMs] },
            );
          }
          throw cause;
        }
      },
      {
        maxAttempts: ANTHROPIC_MAX_TOTAL_ATTEMPTS,
        baseDelayMs: ANTHROPIC_RETRY_BASE_DELAY_MS,
        timeoutMs: options.timeoutMs,
        isRetryable: isRetryableAnthropicError,
      },
    );
  } catch (cause) {
    if (cause instanceof RetryExhaustedError) {
      throw new AnthropicRetryError(
        `Anthropic failed after ${String(ANTHROPIC_MAX_TOTAL_ATTEMPTS)} attempts`,
        anthropicErrorOptions(cause.cause, cause.attemptDurationsMs),
      );
    }

    if (cause instanceof RetryTimeoutError) {
      throw new AnthropicTimeoutError(
        `Anthropic request timed out after ${String(options.timeoutMs)} ms`,
        { cause: cause.cause, attemptDurationsMs: cause.attemptDurationsMs },
      );
    }

    if (cause instanceof AnthropicTimeoutError) {
      throw cause;
    }

    throw normalizeAnthropicError(cause, attemptDurationsMs);
  }
}

function normalizeAnthropicError(cause: unknown, attemptDurationsMs: ReadonlyArray<number>): Error {
  if (cause instanceof AuthenticationError || (cause instanceof APIError && cause.status === 401)) {
    return new AnthropicAuthError(
      "Anthropic request failed with HTTP 401",
      anthropicErrorOptions(cause, attemptDurationsMs),
    );
  }

  return new AnthropicResponseError(
    isAnthropicApiError(cause) && cause.status !== undefined
      ? `Anthropic request failed with HTTP ${String(cause.status)}`
      : "Anthropic API request failed",
    anthropicErrorOptions(cause, attemptDurationsMs),
  );
}

function anthropicErrorOptions(cause: unknown, attemptDurationsMs: ReadonlyArray<number>) {
  if (!(cause instanceof APIError)) return { cause, attemptDurationsMs };

  return {
    cause,
    attemptDurationsMs,
    ...(cause.status !== undefined ? { status: cause.status } : {}),
    ...(cause.requestID !== undefined ? { requestId: cause.requestID } : {}),
  };
}

function isRetryableAnthropicError(cause: unknown): boolean {
  if (cause instanceof APIConnectionError && !(cause instanceof APIConnectionTimeoutError)) {
    return true;
  }

  if (!isAnthropicApiError(cause) || cause.status === undefined) return false;

  // Mirror the Anthropic SDK retry policy: request timeout, lock timeout,
  // rate limit, transport errors, and any 5xx (including 529 overloaded).
  return (
    cause.status === 408 || cause.status === 409 || cause.status === 429 || cause.status >= 500
  );
}

function isAnthropicTimeoutError(cause: unknown): boolean {
  return cause instanceof APIConnectionTimeoutError;
}

function isAnthropicApiError(cause: unknown): cause is APIError {
  return cause instanceof APIError;
}
