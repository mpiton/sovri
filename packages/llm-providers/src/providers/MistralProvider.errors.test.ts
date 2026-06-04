// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server.js";
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
  mistralHttpResponse,
  TestApiKey,
  waitForAbort,
  type MistralComplete,
} from "./MistralProvider.test-helpers.js";

const ErrorBaseUrl = "https://mistral.errors.example";
const ErrorChatUrl = `${ErrorBaseUrl}/v1/chat/completions`;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(() => server.close());

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
    // Given the rejected SDK error includes request header "Authorization: Bearer test-key"
    const apiKey = TestApiKey;
    const cause = new Error(`Authorization: Bearer ${apiKey}`);
    const complete = vi.fn<MistralComplete>(async () => {
      throw cause;
    });
    const provider = new MistralProvider({ apiKey, client: clientFromComplete(complete) });

    // When generateStructured is called
    const error = await captureProviderError(provider.generateStructured(generateParams));

    // Then MistralProviderError is thrown
    // And the thrown error message does not contain "test-key"
    // And the thrown error stack does not contain "test-key"
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

  it("does not retry HTTP 401 responses served by MSW", async () => {
    // Given the first Mistral response is HTTP 401
    let requests = 0;
    server.use(
      http.post(ErrorChatUrl, () => {
        requests += 1;

        return HttpResponse.json({ message: "unauthorized" }, { status: 401 });
      }),
    );
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      baseUrl: ErrorBaseUrl,
    });

    // When generateStructured is called
    const result = provider.generateStructured(generateParams);

    // Then MistralProviderError is thrown
    // And exactly 1 Mistral request is sent
    await expect(result).rejects.toMatchObject({ name: "MistralProviderError", status: 401 });
    expect(requests).toBe(1);
  });

  it("aborts timeout tests with fake timers instead of real wall-clock delay", async () => {
    // Given the Mistral handler never resolves before timeoutMs
    vi.useFakeTimers();
    const complete = vi.fn<MistralComplete>(async (_request, options) => waitForAbort(options));
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      client: clientFromComplete(complete),
      timeoutMs: 1000,
    });

    // When MistralProvider.errors.test.ts calls generateStructured
    const result = provider.generateStructured(generateParams);
    const capturedError = captureProviderError(result);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    // Then a typed Mistral timeout error is thrown
    const error = await capturedError;
    expect(error).toBeInstanceOf(MistralProviderTimeoutError);
  });

  it("throws a typed provider error for schema-invalid MSW responses", async () => {
    // Given the Mistral response body is valid JSON but violates the requested schema
    server.use(
      http.post(ErrorChatUrl, () => {
        return mistralHttpResponse({ summary: 123 });
      }),
    );
    const provider = new MistralProvider({
      apiKey: TestApiKey,
      baseUrl: ErrorBaseUrl,
    });

    // When generateStructured is called
    const result = provider.generateStructured({
      ...generateParams,
      schema: z.strictObject({ summary: z.string() }),
    });

    // Then MistralProviderError is thrown carrying the fields forwarded by the
    // response.ts schema-validation path (not just manual construction)
    const error = await captureProviderError(result);
    expect(error).toBeInstanceOf(MistralProviderError);
    if (!(error instanceof MistralProviderError)) {
      throw new Error("Expected a MistralProviderError");
    }
    expect(error.message).toContain("schema validation");
    expect(error.issues ?? []).not.toHaveLength(0);
    expect(error.retryableWithCorrectivePrompt).toBe(true);
    expect(error.tokenUsage).toEqual({ prompt: 123, completion: 45 });
  });
});

describe("MistralProvider structured error contract", () => {
  it("exposes the full structured field contract on MistralProviderError", () => {
    // Given a schema-validation failure produces real Zod issues (the response.ts path)
    const parsed = z.strictObject({ summary: z.string() }).safeParse({ summary: 123 });
    if (parsed.success) {
      throw new Error("Expected the fixture parse to fail");
    }
    const issues = parsed.error.issues;
    const tokenUsage = { prompt: 11, completion: 7 };

    // When a MistralProviderError carries the full structured options
    const error = new MistralProviderError("Mistral response failed schema validation", {
      status: 422,
      requestId: "req-mistral-contract",
      attemptDurationsMs: [12, 34],
      issues,
      tokenUsage,
      retryableWithCorrectivePrompt: true,
    });

    // Then every structured field is readable by consumers
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-mistral-contract");
    expect(error.attemptDurationsMs).toEqual([12, 34]);
    expect(error.issues).toEqual(issues);
    expect(error.tokenUsage).toEqual(tokenUsage);
    expect(error.retryableWithCorrectivePrompt).toBe(true);
  });

  it("exposes retry diagnostics on retry and timeout errors", () => {
    // Given retry-budget and deadline failures share the diagnostic option shape
    const options = { status: 503, requestId: "req-mistral-retry", attemptDurationsMs: [5, 9, 14] };

    // When the retry and timeout errors are constructed
    const retry = new MistralProviderRetryError("Mistral retry budget exhausted", options);
    const timeout = new MistralProviderTimeoutError("Mistral request timed out", options);

    // Then the retry error exposes the HTTP status, request id, and per-attempt durations
    expect(retry.status).toBe(503);
    expect(retry.requestId).toBe("req-mistral-retry");
    expect(retry.attemptDurationsMs).toEqual([5, 9, 14]);

    // And the timeout error exposes the same diagnostic contract
    expect(timeout.status).toBe(503);
    expect(timeout.requestId).toBe("req-mistral-retry");
    expect(timeout.attemptDurationsMs).toEqual([5, 9, 14]);
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
