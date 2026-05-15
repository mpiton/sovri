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

export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60_000;

const STRUCTURED_OUTPUTS_BETA_HEADER = "structured-outputs-2025-11-13";
const ANTHROPIC_MAX_TOTAL_ATTEMPTS = 3;
const ANTHROPIC_RETRY_BASE_DELAY_MS = 500;
const ANTHROPIC_RETRY_JITTER_RATIO = 0.2;

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
  return createMessageAttempt({
    ...options,
    attempt: 1,
    attemptDurationsMs: [],
    deadlineMs: Date.now() + options.timeoutMs,
  });
}

async function createMessageAttempt(options: {
  readonly attempt: number;
  readonly attemptDurationsMs: ReadonlyArray<number>;
  readonly client: AnthropicMessagesClient;
  readonly deadlineMs: number;
  readonly request: MessageCreateParamsNonStreaming;
  readonly timeoutMs: number;
}): Promise<unknown> {
  const remainingMs = options.deadlineMs - Date.now();

  if (remainingMs <= 0) {
    throw new AnthropicTimeoutError(
      `Anthropic request timed out after ${String(options.timeoutMs)} ms`,
      { attemptDurationsMs: options.attemptDurationsMs },
    );
  }

  const controller = new AbortController();
  const startedAtMs = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = options.client.messages.create(options.request, {
      headers: { "anthropic-beta": STRUCTURED_OUTPUTS_BETA_HEADER },
      maxRetries: 0,
      signal: controller.signal,
      timeout: remainingMs,
    });
    timeout = setTimeout(() => controller.abort(), remainingMs);

    return await response;
  } catch (cause) {
    return handleMessageFailure({
      ...options,
      attemptDurationsMs: [...options.attemptDurationsMs, Date.now() - startedAtMs],
      cause,
      timedOut: controller.signal.aborted,
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function handleMessageFailure(options: {
  readonly attempt: number;
  readonly attemptDurationsMs: ReadonlyArray<number>;
  readonly cause: unknown;
  readonly client: AnthropicMessagesClient;
  readonly deadlineMs: number;
  readonly request: MessageCreateParamsNonStreaming;
  readonly timedOut: boolean;
  readonly timeoutMs: number;
}): Promise<unknown> {
  if (options.timedOut || isAnthropicTimeoutError(options.cause)) {
    throw new AnthropicTimeoutError(
      `Anthropic request timed out after ${String(options.timeoutMs)} ms`,
      { cause: options.cause, attemptDurationsMs: options.attemptDurationsMs },
    );
  }

  if (!isRetryableAnthropicError(options.cause)) {
    throw normalizeAnthropicError(options.cause, options.attemptDurationsMs);
  }

  if (options.attempt === ANTHROPIC_MAX_TOTAL_ATTEMPTS) {
    throw new AnthropicRetryError(
      `Anthropic failed after ${String(ANTHROPIC_MAX_TOTAL_ATTEMPTS)} attempts`,
      anthropicErrorOptions(options.cause, options.attemptDurationsMs),
    );
  }

  const delayMs = retryDelayMs(options.attempt);

  if (options.deadlineMs - Date.now() <= delayMs) {
    throw new AnthropicTimeoutError(
      `Anthropic request timed out after ${String(options.timeoutMs)} ms`,
      { cause: options.cause, attemptDurationsMs: options.attemptDurationsMs },
    );
  }

  await sleep(delayMs);

  return createMessageAttempt({
    ...options,
    attempt: options.attempt + 1,
  });
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
  if (cause instanceof APIConnectionError) return true;

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

function retryDelayMs(completedAttempt: number): number {
  const nominalDelayMs = ANTHROPIC_RETRY_BASE_DELAY_MS * 2 ** (completedAttempt - 1);
  const jitterFactor = (Math.random() * 2 - 1) * ANTHROPIC_RETRY_JITTER_RATIO;

  return Math.round(nominalDelayMs * (1 + jitterFactor));
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
