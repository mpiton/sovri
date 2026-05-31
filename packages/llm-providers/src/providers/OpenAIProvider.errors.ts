// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

import type { TokenUsage } from "../types/LLMProvider.js";

export interface OpenAIProviderErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly requestId?: string | null;
  readonly code?: string | null;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;
}

type OpenAIProviderErrorName =
  | "OpenAIProviderAuthError"
  | "OpenAIProviderError"
  | "OpenAIProviderRetryError"
  | "OpenAIProviderTimeoutError";

/** Base OpenAI provider failure with SDK metadata, Zod issues, and token usage when available. */
export class OpenAIProviderError<
  Name extends OpenAIProviderErrorName = "OpenAIProviderError",
> extends Error {
  readonly status?: number;
  readonly requestId?: string | null;
  readonly code?: string | null;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
  readonly tokenUsage?: TokenUsage;
  readonly retryableWithCorrectivePrompt?: true;

  override get name(): Name {
    return this.errorName;
  }

  protected get errorName(): Name {
    return "OpenAIProviderError" as Name;
  }

  constructor(message: string, options: OpenAIProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.code !== undefined) {
      this.code = options.code;
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

/** OpenAI authentication or authorization failure, including invalid or unauthorized API keys. */
export class OpenAIProviderAuthError extends OpenAIProviderError<"OpenAIProviderAuthError"> {
  protected override get errorName(): "OpenAIProviderAuthError" {
    return "OpenAIProviderAuthError";
  }
}

/** Retry budget exhaustion after all retryable OpenAI request attempts fail. */
export class OpenAIProviderRetryError extends OpenAIProviderError<"OpenAIProviderRetryError"> {
  protected override get errorName(): "OpenAIProviderRetryError" {
    return "OpenAIProviderRetryError";
  }
}

/** Overall OpenAI request timeout before a successful retry attempt completes. */
export class OpenAIProviderTimeoutError extends OpenAIProviderError<"OpenAIProviderTimeoutError"> {
  protected override get errorName(): "OpenAIProviderTimeoutError" {
    return "OpenAIProviderTimeoutError";
  }
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
