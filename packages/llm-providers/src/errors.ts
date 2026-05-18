// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

import type { TokenUsage } from "./types/LLMProvider.js";

export interface AnthropicProviderErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
}

export interface AnthropicResponseErrorOptions extends AnthropicProviderErrorOptions {
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;
}

type AnthropicResponseErrorName =
  | "AnthropicResponseError"
  | "AnthropicRetryError"
  | "AnthropicTimeoutError";

export class AnthropicAuthError extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;

  override get name(): "AnthropicAuthError" {
    return "AnthropicAuthError";
  }

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

export class AnthropicResponseError<
  Name extends AnthropicResponseErrorName = "AnthropicResponseError",
> extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly attemptDurationsMs?: ReadonlyArray<number>;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;

  override get name(): Name {
    return this.errorName;
  }

  protected get errorName(): Name {
    return "AnthropicResponseError" as Name;
  }

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
    if (options.tokenUsage !== undefined) {
      this.tokenUsage = options.tokenUsage;
    }
    if (options.retryableWithCorrectivePrompt !== undefined) {
      this.retryableWithCorrectivePrompt = options.retryableWithCorrectivePrompt;
    }
  }
}

export class AnthropicRetryError extends AnthropicResponseError<"AnthropicRetryError"> {
  protected override get errorName(): "AnthropicRetryError" {
    return "AnthropicRetryError";
  }
}

export class AnthropicTimeoutError extends AnthropicResponseError<"AnthropicTimeoutError"> {
  protected override get errorName(): "AnthropicTimeoutError" {
    return "AnthropicTimeoutError";
  }
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
