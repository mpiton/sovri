// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import { MistralProvider, MistralProviderTimeoutError } from "./MistralProvider.js";
import {
  captureError,
  clientFromComplete,
  FakeRequestTimeoutError,
  flushPromises,
  generateParams,
  TestApiKey,
  validStructuredResponse,
  waitForAbort,
  waitForResponseOrAbort,
  type MistralComplete,
} from "./MistralProvider.test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MistralProvider timeout handling", () => {
  it("aborts an in-flight request after the configured timeout", async () => {
    // Given timeoutMs is 200
    // And the Mistral SDK chat completion waits for its AbortSignal
    vi.useFakeTimers();
    const complete = vi.fn<MistralComplete>(async (_request, options) => waitForAbort(options));
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
      timeoutMs: 200,
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);

    // Then the AbortSignal passed to the SDK is aborted
    // And a typed Mistral timeout error is thrown
    const error = await capturedError;
    expect(error).toBeInstanceOf(MistralProviderTimeoutError);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    { responseMs: 999, outcome: "success" },
    { responseMs: 1000, outcome: "success" },
    { responseMs: 1001, outcome: "timeout" },
  ])("handles timeout boundary at $responseMs ms as $outcome", async ({ responseMs, outcome }) => {
    // Given timeoutMs is 1000
    // And the Mistral SDK chat completion returns JSON content after <response_ms> ms
    vi.useFakeTimers();
    const complete = vi.fn<MistralComplete>(async (_request, options) =>
      waitForResponseOrAbort(responseMs, options),
    );
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
      timeoutMs: 1000,
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);
    const capturedError = outcome === "timeout" ? captureError(result) : undefined;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(responseMs);

    // Then the provider outcome is "<outcome>"
    if (outcome === "success") {
      await expect(result).resolves.toEqual(validStructuredResponse);
    } else {
      await expect(capturedError).resolves.toBeInstanceOf(MistralProviderTimeoutError);
    }
  });

  it("rejects immediately when waitForResponseOrAbort receives a pre-aborted signal", async () => {
    // Given an AbortController whose signal is already aborted
    const controller = new AbortController();
    controller.abort();

    // When waitForResponseOrAbort runs with that signal
    const promise = waitForResponseOrAbort(1000, { signal: controller.signal });

    // Then it rejects with an AbortError without waiting for the timer
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps SDK timeout errors without retrying", async () => {
    const complete = vi.fn<MistralComplete>(async () => {
      throw new FakeRequestTimeoutError("timed out");
    });
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
    });

    await expect(provider.generateStructured(generateParams)).rejects.toBeInstanceOf(
      MistralProviderTimeoutError,
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
