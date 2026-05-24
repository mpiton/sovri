// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import { MistralProvider, MistralProviderRetryError } from "./MistralProvider.js";
import {
  captureError,
  clientFromComplete,
  FakeConnectionError,
  FakeMistralHttpError,
  flushPromises,
  generateParams,
  mistralCompletion,
  TestApiKey,
  TestModel,
  validStructuredResponse,
  type MistralComplete,
} from "./MistralProvider.test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MistralProvider retry and timeout handling", () => {
  it.each([408, 409, 429, 500, 502, 503, 504])(
    "retries transient HTTP %i once and returns structured data",
    async (statusCode) => {
      // Given the first Mistral SDK chat completion rejects with "<error_token>"
      // And the second Mistral SDK chat completion returns JSON content
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const complete = createCompletionSequence([
        new FakeMistralHttpError(statusCode),
        mistralCompletion(validStructuredResponse),
      ]);
      const provider = new MistralProvider({
        apiKey: TestApiKey,
        client: clientFromComplete(complete),
        model: TestModel,
      });

      // When generateStructured is called
      const result = provider.generateStructured(generateParams);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(500);

      // Then exactly 2 chat completion attempts are made
      // And the result has summary "Recovered"
      await expect(result).resolves.toEqual(validStructuredResponse);
      expect(complete).toHaveBeenCalledTimes(2);
    },
  );

  it("retries network errors once and returns structured data", async () => {
    // Given the first Mistral SDK chat completion rejects with "NETWORK"
    // And the second Mistral SDK chat completion returns JSON content
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const complete = createCompletionSequence([
      new FakeConnectionError("network down"),
      mistralCompletion(validStructuredResponse),
    ]);
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    // Then exactly 2 chat completion attempts are made
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("stops retryable failures at the configured maxAttempts", async () => {
    // Given every Mistral SDK chat completion rejects with "HTTP_503"
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const complete = createCompletionSequence([
      new FakeMistralHttpError(503),
      new FakeMistralHttpError(503),
    ]);
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
      maxAttempts: 2,
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    // Then exactly 2 chat completion attempts are made
    // And a typed Mistral retry error is thrown
    const error = await capturedError;
    expect(error).toBeInstanceOf(MistralProviderRetryError);
    expect(error).toMatchObject({ name: "MistralProviderRetryError" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2, 3])("uses configured maxAttempts value %i", async (maxAttempts) => {
    // Given maxAttempts is <max_attempts>
    // And every Mistral SDK chat completion rejects with "HTTP_429"
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const complete = createRepeatedError(new FakeMistralHttpError(429));
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
      maxAttempts,
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(maxAttempts === 3 ? 1500 : 500);

    // Then exactly <expected_attempts> chat completion attempts are made
    await expect(capturedError).resolves.toBeInstanceOf(MistralProviderRetryError);
    expect(complete).toHaveBeenCalledTimes(maxAttempts);
  });

  it.each([400, 401, 403, 404, 422])("does not retry non-transient HTTP %i", async (statusCode) => {
    // Given the first Mistral SDK chat completion rejects with "<error_token>"
    const cause = new FakeMistralHttpError(statusCode);
    const complete = createCompletionSequence([cause]);
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);

    // Then exactly 1 chat completion attempt is made
    // And MistralProviderError is thrown
    await expect(result).rejects.toMatchObject({ name: "MistralProviderError", cause });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

function createCompletionSequence(outcomes: ReadonlyArray<unknown>): MistralComplete {
  const pending = [...outcomes];

  return vi.fn<MistralComplete>(async () => {
    const outcome = pending.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
}

function createRepeatedError(error: Error): MistralComplete {
  return vi.fn<MistralComplete>(async () => {
    throw error;
  });
}
