// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import {
  MistralProvider,
  MistralProviderError,
  MistralProviderRetryError,
  MistralProviderTimeoutError,
} from "./MistralProvider.js";
import {
  clientFromComplete,
  FakeMistralHttpError,
  generateParams,
  TestApiKey,
  type MistralComplete,
} from "./MistralProvider.test-helpers.js";

describe("MistralProvider errors and redaction", () => {
  it("preserves literal error names for discriminated narrowing", () => {
    const responseName: "MistralProviderError" = new MistralProviderError("test").name;
    const retryName: "MistralProviderRetryError" = new MistralProviderRetryError("test").name;
    const timeoutName: "MistralProviderTimeoutError" = new MistralProviderTimeoutError("test").name;

    expect([responseName, retryName, timeoutName]).toEqual([
      "MistralProviderError",
      "MistralProviderRetryError",
      "MistralProviderTimeoutError",
    ]);
  });

  it("redacts API keys from provider error messages and stacks", async () => {
    // Given the rejected SDK error includes request header "Authorization: Bearer mistral-secret-key-123"
    const apiKey = "mistral-secret-key-123";
    const cause = new Error(`Authorization: Bearer ${apiKey}`);
    const complete = vi.fn<MistralComplete>(async () => {
      throw cause;
    });
    const provider = new MistralProvider({ apiKey, client: clientFromComplete(complete) });

    // When generateStructured is called
    const error = await captureProviderError(provider.generateStructured(generateParams));

    // Then MistralProviderError is thrown
    // And the thrown error message does not contain "mistral-secret-key-123"
    // And the thrown error stack does not contain "mistral-secret-key-123"
    expect(error).toMatchObject({
      name: "MistralProviderError",
      cause,
    });
    expect(error.message).not.toContain(apiKey);
    expect(error.stack ?? "").not.toContain(apiKey);
  });

  it("preserves the original cause for non-retryable client errors", async () => {
    // Given the first Mistral SDK chat completion rejects with "HTTP_401"
    const cause = new FakeMistralHttpError(401);
    const complete = vi.fn<MistralComplete>(async () => {
      throw cause;
    });
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructured is called
    // Then MistralProviderError is thrown
    await expect(provider.generateStructured(generateParams)).rejects.toMatchObject({
      name: "MistralProviderError",
      status: 401,
      cause,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

async function captureProviderError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error("Expected provider call to reject");
}
