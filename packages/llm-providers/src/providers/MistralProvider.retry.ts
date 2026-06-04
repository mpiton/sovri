// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Mistral } from "@mistralai/mistralai";

import {
  retryWithBackoff,
  RetryExhaustedError,
  RetryTimeoutError,
  type AttemptContext,
} from "../helpers/retry.js";
import {
  MistralProviderError,
  MistralProviderRetryError,
  MistralProviderTimeoutError,
  type MistralProviderErrorOptions,
} from "./MistralProvider.errors.js";

export const DEFAULT_MISTRAL_TIMEOUT_MS = 60_000;
export const DEFAULT_MISTRAL_MAX_ATTEMPTS = 3;

const MISTRAL_RETRY_BASE_DELAY_MS = 500;

export type MistralChatComplete = Mistral["chat"]["complete"];
export type MistralChatRequest = Parameters<MistralChatComplete>[0];
type MistralChatOptions = Parameters<MistralChatComplete>[1];

export interface MistralChatClient {
  readonly chat: {
    readonly complete: MistralChatComplete;
  };
}

export async function createMistralChatCompletionWithRetry(options: {
  readonly client: MistralChatClient;
  readonly request: MistralChatRequest;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
}): Promise<unknown> {
  const attemptDurationsMs: number[] = [];

  try {
    return await retryWithBackoff(
      async (ctx: AttemptContext) => {
        const startedAt = Date.now();
        try {
          return await options.client.chat.complete(
            options.request,
            createMistralRequestOptions(ctx),
          );
        } catch (cause) {
          attemptDurationsMs.push(Date.now() - startedAt);
          if (isMistralTimeoutError(cause)) {
            throw new MistralProviderTimeoutError(
              `Mistral request timed out after ${String(options.timeoutMs)} ms`,
              mistralErrorOptions(cause, attemptDurationsMs),
            );
          }
          throw cause;
        }
      },
      {
        maxAttempts: options.maxAttempts,
        baseDelayMs: MISTRAL_RETRY_BASE_DELAY_MS,
        timeoutMs: options.timeoutMs,
        isRetryable: isRetryableMistralError,
      },
    );
  } catch (cause) {
    if (cause instanceof RetryExhaustedError) {
      throw new MistralProviderRetryError(
        `Mistral failed after ${String(options.maxAttempts)} attempts`,
        mistralErrorOptions(cause.cause, cause.attemptDurationsMs),
      );
    }

    if (cause instanceof RetryTimeoutError) {
      throw new MistralProviderTimeoutError(
        `Mistral request timed out after ${String(options.timeoutMs)} ms`,
        mistralErrorOptions(cause.cause, cause.attemptDurationsMs),
      );
    }

    if (cause instanceof MistralProviderTimeoutError) {
      throw cause;
    }

    throw normalizeMistralError(cause, attemptDurationsMs);
  }
}

function createMistralRequestOptions(ctx: AttemptContext): MistralChatOptions {
  return {
    retries: { strategy: "none" },
    retryCodes: [],
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
  };
}

function normalizeMistralError(cause: unknown, attemptDurationsMs: ReadonlyArray<number>): Error {
  return new MistralProviderError(
    statusCodeFrom(cause) !== undefined
      ? `Mistral request failed with HTTP ${String(statusCodeFrom(cause))}`
      : "Mistral API request failed",
    mistralErrorOptions(cause, attemptDurationsMs),
  );
}

function mistralErrorOptions(
  cause: unknown,
  attemptDurationsMs: ReadonlyArray<number>,
): MistralProviderErrorOptions {
  const options: MistralProviderErrorOptions = { cause, attemptDurationsMs };
  const status = statusCodeFrom(cause);
  const requestId = requestIdFrom(cause);

  if (status !== undefined) {
    return requestId === undefined ? { ...options, status } : { ...options, status, requestId };
  }

  return requestId === undefined ? options : { ...options, requestId };
}

function isRetryableMistralError(cause: unknown): boolean {
  if (isMistralNetworkError(cause)) return true;

  const statusCode = statusCodeFrom(cause);
  if (statusCode === undefined) return false;

  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

function isMistralNetworkError(cause: unknown): boolean {
  if (cause instanceof TypeError) return true;
  if (!isJsonObject(cause)) return false;

  return Reflect.get(cause, "name") === "ConnectionError";
}

function isMistralTimeoutError(cause: unknown): boolean {
  if (!isJsonObject(cause)) return false;

  return Reflect.get(cause, "name") === "RequestTimeoutError";
}

function statusCodeFrom(cause: unknown): number | undefined {
  if (!isJsonObject(cause)) return undefined;

  const statusCode = Reflect.get(cause, "statusCode");
  if (isValidStatusCode(statusCode)) return statusCode;

  const status = Reflect.get(cause, "status");
  return isValidStatusCode(status) ? status : undefined;
}

function requestIdFrom(cause: unknown): string | undefined {
  if (!isJsonObject(cause)) return undefined;

  const headers = Reflect.get(cause, "headers");
  if (headers instanceof Headers) {
    return headers.get("x-request-id") ?? undefined;
  }

  return undefined;
}

function isValidStatusCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
