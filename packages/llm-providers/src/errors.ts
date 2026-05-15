// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

export interface AnthropicProviderErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
}

export interface AnthropicResponseErrorOptions extends AnthropicProviderErrorOptions {
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
}

export class AnthropicAuthError extends Error {
  override readonly name: string = "AnthropicAuthError";
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;

  constructor(message: string, options: AnthropicProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.attemptDurationsMs !== undefined) {
      this.attemptDurationsMs = [...options.attemptDurationsMs];
    }
  }
}

export class AnthropicResponseError extends Error {
  override readonly name: string = "AnthropicResponseError";
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;

  constructor(message: string, options: AnthropicResponseErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.attemptDurationsMs !== undefined) {
      this.attemptDurationsMs = [...options.attemptDurationsMs];
    }
    if (options.issues !== undefined) {
      this.issues = options.issues;
    }
  }
}

export class AnthropicRetryError extends AnthropicResponseError {
  override readonly name: string = "AnthropicRetryError";
}

export class AnthropicTimeoutError extends AnthropicResponseError {
  override readonly name: string = "AnthropicTimeoutError";
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
