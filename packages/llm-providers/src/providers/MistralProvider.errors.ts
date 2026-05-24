// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

import type { TokenUsage } from "../types/LLMProvider.js";

export interface MistralProviderErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;
}

export class MistralProviderError extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;

  override get name(): "MistralProviderError" {
    return "MistralProviderError";
  }

  constructor(message: string, options: MistralProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));
    applyMistralErrorOptions(this, options);
  }
}

export class MistralProviderRetryError extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;

  override get name(): "MistralProviderRetryError" {
    return "MistralProviderRetryError";
  }

  constructor(message: string, options: MistralProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));
    applyMistralErrorOptions(this, options);
  }
}

export class MistralProviderTimeoutError extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;

  override get name(): "MistralProviderTimeoutError" {
    return "MistralProviderTimeoutError";
  }

  constructor(message: string, options: MistralProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));
    applyMistralErrorOptions(this, options);
  }
}

function applyMistralErrorOptions(
  error: MistralProviderError | MistralProviderRetryError | MistralProviderTimeoutError,
  options: MistralProviderErrorOptions,
): void {
  if (options.status !== undefined) {
    Object.defineProperty(error, "status", { value: options.status, enumerable: true });
  }
  if (options.requestId !== undefined) {
    Object.defineProperty(error, "requestId", { value: options.requestId, enumerable: true });
  }
  if (options.attemptDurationsMs !== undefined) {
    Object.defineProperty(error, "attemptDurationsMs", {
      value: [...options.attemptDurationsMs],
      enumerable: true,
    });
  }
  if (error instanceof MistralProviderError && options.issues !== undefined) {
    Object.defineProperty(error, "issues", { value: options.issues, enumerable: true });
  }
  if (error instanceof MistralProviderError && options.tokenUsage !== undefined) {
    Object.defineProperty(error, "tokenUsage", { value: options.tokenUsage, enumerable: true });
  }
  if (
    error instanceof MistralProviderError &&
    options.retryableWithCorrectivePrompt !== undefined
  ) {
    Object.defineProperty(error, "retryableWithCorrectivePrompt", {
      value: options.retryableWithCorrectivePrompt,
      enumerable: true,
    });
  }
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
