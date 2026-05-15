// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { z } from "@sovri/core";

export interface AnthropicProviderErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly requestId?: string | null;
}

export interface AnthropicResponseErrorOptions extends AnthropicProviderErrorOptions {
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;
}

export class AnthropicAuthError extends Error {
  override readonly name = "AnthropicAuthError";
  readonly status?: number;
  readonly requestId?: string | null;

  constructor(message: string, options: AnthropicProviderErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
  }
}

export class AnthropicResponseError extends Error {
  override readonly name = "AnthropicResponseError";
  readonly status?: number;
  readonly requestId?: string | null;
  readonly issues?: ReadonlyArray<z.core.$ZodIssue>;

  constructor(message: string, options: AnthropicResponseErrorOptions = {}) {
    super(message, errorOptions(options.cause));

    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.issues !== undefined) {
      this.issues = options.issues;
    }
  }
}

function errorOptions(cause: unknown): ErrorOptions | undefined {
  return cause === undefined ? undefined : { cause };
}
