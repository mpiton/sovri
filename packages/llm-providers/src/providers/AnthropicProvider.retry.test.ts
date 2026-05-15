// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { z } from "@sovri/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicAuthError, AnthropicRetryError, AnthropicTimeoutError } from "../errors.js";
import {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  type AnthropicProviderOptions,
} from "./AnthropicProvider.js";

const TestModel = "claude-sonnet-4-test";

const ReviewResultSchema = z.strictObject({
  summary: z.string(),
  findings: z.array(z.string()),
  walkthrough_markdown: z.string(),
});

const validStructuredResponse = {
  summary: "The diff looks safe.",
  findings: [],
  walkthrough_markdown: "Reviewed the auth handler changes.",
};

const generateParams = {
  systemPrompt: "Review this pull request and answer with JSON only.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: ReviewResultSchema,
  maxTokens: 512,
  temperature: 0,
};

type AnthropicClient = NonNullable<AnthropicProviderOptions["client"]>;
type AnthropicCreate = AnthropicClient["messages"]["create"];
type AnthropicCreateOptions = Parameters<AnthropicCreate>[1];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("AnthropicProvider retry and timeout handling", () => {
  it("retries HTTP 429 once and returns the valid completion", async () => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And the exponential backoff base delay is 500 ms
    // And the first Anthropic response is HTTP 429
    // And the second Anthropic response is a valid completion
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const create = createMessageSequence([apiError(429), anthropicMessage()]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    // Then the adapter returns the valid completion
    // And exactly 2 Anthropic requests are sent
    // And the retry delay before the second request is based on 500 ms
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("fails after three total HTTP 503 attempts with attempt durations", async () => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And each Anthropic response is HTTP 503
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const create = createMessageSequence([apiError(503), apiError(503), apiError(503)]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1500);

    // Then the adapter fails after the third response
    // And exactly 3 Anthropic requests are sent
    // And the retry delays are based on 500 ms and 1000 ms
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicRetryError);
    expect(error).toMatchObject({
      name: "AnthropicRetryError",
      message: "Anthropic failed after 3 attempts",
      attemptDurationsMs: [0, 0, 0],
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("records every attempt duration when transient failures are exhausted", async () => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And Anthropic returns HTTP 503 after 40 ms on the first request
    // And Anthropic returns HTTP 503 after 55 ms on the second request
    // And Anthropic returns HTTP 503 after 70 ms on the third request
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const create = createDelayedErrorSequence([
      { responseMs: 40, error: apiError(503) },
      { responseMs: 55, error: apiError(503) },
      { responseMs: 70, error: apiError(503) },
    ]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(40);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(55);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(70);

    // Then the adapter throws a typed provider retry error
    // And the error records attempt durations of 40 ms, 55 ms, and 70 ms
    // And the error message states that Anthropic failed after 3 attempts
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicRetryError);
    expect(error).toMatchObject({
      name: "AnthropicRetryError",
      message: "Anthropic failed after 3 attempts",
      attemptDurationsMs: [40, 55, 70],
    });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it.each([408, 409, 500, 502, 504, 529])(
    "retries transient HTTP %i once and returns the valid completion",
    async (status) => {
      // Given the Anthropic adapter is configured with max 3 total attempts
      // And the first Anthropic response is a documented transient status
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const create = createMessageSequence([apiError(status), anthropicMessage()]);
      const provider = new AnthropicProvider({
        client: clientFromCreate(create),
        model: TestModel,
      });

      // When the review engine calls Anthropic once
      const result = provider.generateStructured(generateParams);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(500);

      // Then the adapter returns the valid completion
      // And exactly 2 Anthropic requests are sent
      await expect(result).resolves.toEqual(validStructuredResponse);
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it("retries Anthropic SDK connection errors once and returns the valid completion", async () => {
    // Given the Anthropic SDK reports a transient transport failure
    // And the second Anthropic response is a valid completion
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const create = createMessageSequence([
      new APIConnectionError({ message: "Connection reset." }),
      anthropicMessage(),
    ]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    // Then the adapter retries the transport failure
    // And returns the valid completion
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry HTTP 401", async () => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And the first Anthropic response is HTTP 401
    const create = createMessageSequence([apiError(401)]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);

    // Then the adapter fails the call
    // And exactly 1 Anthropic request is sent
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicAuthError);
    expect(error).toMatchObject({ attemptDurationsMs: [expect.any(Number)], status: 401 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("records one attempt duration for immediate non-retryable failures", async () => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And Anthropic returns HTTP 401 after 30 ms on the first request
    vi.useFakeTimers();
    const create = createDelayedErrorSequence([{ responseMs: 30, error: apiError(401) }]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30);

    // Then the adapter throws a typed provider error
    // And the error records one attempt duration of 30 ms
    // And exactly 1 Anthropic request is sent
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicAuthError);
    expect(error).toMatchObject({
      name: "AnthropicAuthError",
      attemptDurationsMs: [30],
      status: 401,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 422])("does not retry non-transient HTTP %i", async (status) => {
    // Given the Anthropic adapter is configured with max 3 total attempts
    // And the first Anthropic response is HTTP <status>
    const create = createMessageSequence([apiError(status)]);
    const provider = new AnthropicProvider({
      client: clientFromCreate(create),
      model: TestModel,
    });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);

    // Then the adapter fails the call
    // And exactly 1 Anthropic request is sent
    await expect(capturedError).resolves.toMatchObject({
      attemptDurationsMs: [expect.any(Number)],
      status,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("aborts after the configured timeout without retrying", async () => {
    // Given the Anthropic adapter is configured with a timeout of 200 ms
    // And the Anthropic response would arrive after 1000 ms
    vi.useFakeTimers();
    const create = vi.fn<AnthropicCreate>(async (_request, options) => waitForAbort(options));
    const provider = new AnthropicProvider({
      client: clientFromCreate(create),
      model: TestModel,
      timeoutMs: 200,
    });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);

    // Then the AbortController aborts the request after 200 ms
    // And the adapter fails with a typed timeout error message
    // And exactly 1 Anthropic request is sent
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicTimeoutError);
    expect(error).toMatchObject({
      name: "AnthropicTimeoutError",
      message: "Anthropic request timed out after 200 ms",
      attemptDurationsMs: [200],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      mode: "exhausted-503",
      durations: [40, 55, 70],
      errorName: "AnthropicRetryError",
      message: "Anthropic failed after 3 attempts",
      attemptCount: 3,
    },
    {
      mode: "immediate-401",
      durations: [30],
      errorName: "AnthropicAuthError",
      message: "Anthropic request failed with HTTP 401",
      attemptCount: 1,
    },
    {
      mode: "timeout",
      durations: [200],
      errorName: "AnthropicTimeoutError",
      message: "Anthropic request timed out after 200 ms",
      attemptCount: 1,
    },
  ])(
    "matches final failure error shape for $mode",
    async ({ mode, durations, errorName, message, attemptCount }) => {
      // Given the Anthropic adapter reaches terminal failure mode "<mode>"
      // And the recorded attempt durations are "<durations>"
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const create = createTerminalFailure(mode);
      const provider = new AnthropicProvider({
        client: clientFromCreate(create),
        model: TestModel,
        timeoutMs: 200,
      });

      // When the review engine handles the Anthropic failure
      const result = provider.generateStructured(generateParams);
      const capturedError = captureError(result);
      await flushPromises();
      await advanceTerminalFailureTimers(mode);

      // Then the thrown error type is "<error_type>"
      // And the error message is "<message>"
      // And the error records <attempt_count> attempt duration(s)
      const error = await capturedError;
      expect(error).toMatchObject({
        name: errorName,
        message,
        attemptDurationsMs: durations,
      });
      expectAttemptDurationCount(error, attemptCount);
    },
  );

  it("maps Anthropic SDK timeout errors without retrying", async () => {
    // Given the Anthropic SDK reports a transport timeout
    // And the adapter timeout is configured to 200 ms
    const create = createMessageSequence([new APIConnectionTimeoutError()]);
    const provider = new AnthropicProvider({
      client: clientFromCreate(create),
      model: TestModel,
      timeoutMs: 200,
    });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    const capturedError = captureError(result);

    // Then the SDK timeout is normalized to the adapter timeout error
    // And exactly 1 Anthropic request is sent
    const error = await capturedError;
    expect(error).toBeInstanceOf(AnthropicTimeoutError);
    expect(error).toMatchObject({
      name: "AnthropicTimeoutError",
      message: "Anthropic request timed out after 200 ms",
      attemptDurationsMs: [expect.any(Number)],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("uses the default 60 second timeout when no explicit timeout is provided", async () => {
    // Given the Anthropic adapter is created without an explicit timeout
    // And the Anthropic response arrives after 250 ms
    vi.useFakeTimers();
    let capturedOptions: AnthropicCreateOptions | undefined;
    const create = vi.fn<AnthropicCreate>(async (_request, options) => {
      capturedOptions = options;
      await sleep(250);
      return anthropicMessage();
    });
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(250);

    // Then the request uses an AbortController timeout of 60000 ms
    // And the adapter returns the valid completion
    expect(capturedOptions?.timeout).toBe(DEFAULT_ANTHROPIC_TIMEOUT_MS);
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("uses the configured timeout when provided", async () => {
    // Given the Anthropic adapter is configured with a timeout of 1500 ms
    // And the Anthropic response arrives after 1000 ms
    vi.useFakeTimers();
    let capturedOptions: AnthropicCreateOptions | undefined;
    const create = vi.fn<AnthropicCreate>(async (_request, options) => {
      capturedOptions = options;
      await sleep(1000);
      return anthropicMessage();
    });
    const provider = new AnthropicProvider({
      client: clientFromCreate(create),
      model: TestModel,
      timeoutMs: 1500,
    });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);

    // Then the request uses an AbortController timeout of 1500 ms
    // And the adapter returns the valid completion
    expect(capturedOptions?.timeout).toBe(1500);
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { responseMs: 999, outcome: "success" },
    { responseMs: 1000, outcome: "success" },
    { responseMs: 1001, outcome: "timeout" },
  ])(
    "handles timeout boundary response after $responseMs ms as $outcome",
    async ({ responseMs, outcome }) => {
      // Given the Anthropic adapter is configured with a timeout of 1000 ms
      // And the Anthropic response arrives after <response_ms> ms
      vi.useFakeTimers();
      const create = vi.fn<AnthropicCreate>(async (_request, options) =>
        waitForResponseOrAbort(responseMs, options),
      );
      const provider = new AnthropicProvider({
        client: clientFromCreate(create),
        model: TestModel,
        timeoutMs: 1000,
      });

      // When the review engine calls Anthropic once
      const result = provider.generateStructured(generateParams);
      const capturedError = outcome === "timeout" ? captureError(result) : undefined;
      await flushPromises();
      await vi.advanceTimersByTimeAsync(responseMs);

      // Then the call outcome is "<outcome>"
      if (outcome === "success") {
        await expect(result).resolves.toEqual(validStructuredResponse);
      } else {
        const error = await capturedError;
        expect(error).toBeInstanceOf(AnthropicTimeoutError);
      }
    },
  );

  it("applies positive 20 percent jitter to the first retry delay", async () => {
    // Given the exponential backoff base delay is 500 ms
    // And retry jitter is bounded to plus or minus 20 percent
    // And the selected jitter factor is positive 20 percent
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const create = createMessageSequence([apiError(429), anthropicMessage()]);
    const provider = new AnthropicProvider({ client: clientFromCreate(create), model: TestModel });

    // When the review engine calls Anthropic once
    const result = provider.generateStructured(generateParams);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(599);

    // Then the adapter waits 600 ms before the second request
    // And the adapter does not wait the exact base delay of 500 ms
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(validStructuredResponse);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    { randomValue: 0, retryDelayMs: 400 },
    { randomValue: 1, retryDelayMs: 600 },
  ])(
    "keeps first retry delay inside bounded jitter at $retryDelayMs ms",
    async ({ randomValue, retryDelayMs }) => {
      // Given the Anthropic adapter is configured with max 3 total attempts
      // And the exponential backoff base delay is 500 ms
      // And retry jitter is bounded to plus or minus 20 percent
      // And the first Anthropic response is HTTP 503
      // And the second Anthropic response is a valid completion
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(randomValue);
      const create = createMessageSequence([apiError(503), anthropicMessage()]);
      const provider = new AnthropicProvider({
        client: clientFromCreate(create),
        model: TestModel,
      });

      // When the review engine calls Anthropic once
      const result = provider.generateStructured(generateParams);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(retryDelayMs - 1);

      // Then the adapter waits between 400 ms and 600 ms before the second request
      // And the adapter returns the valid completion
      expect(create).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual(validStructuredResponse);
      expect(create).toHaveBeenCalledTimes(2);
    },
  );

  it("spreads same-window transient failures across jittered retry delays", async () => {
    // Given three Anthropic calls receive HTTP 503 at 10:00:00.000 UTC
    // And retry jitter is bounded to plus or minus 20 percent
    // And the selected jitter factors are negative 20 percent, 0 percent, and positive 20 percent
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00.000Z") });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1);
    const create = createMessageSequence([
      apiError(503),
      apiError(503),
      apiError(503),
      anthropicMessage(),
      anthropicMessage(),
      anthropicMessage(),
    ]);
    const providers = [
      new AnthropicProvider({ client: clientFromCreate(create), model: TestModel }),
      new AnthropicProvider({ client: clientFromCreate(create), model: TestModel }),
      new AnthropicProvider({ client: clientFromCreate(create), model: TestModel }),
    ];

    // When each call schedules its first retry
    const results = providers.map((provider) => provider.generateStructured(generateParams));
    await flushPromises();

    // Then the first call retries after 400 ms
    // And the second call retries after 500 ms
    // And the third call retries after 600 ms
    expect(create).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(create).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(create).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(100);
    expect(create).toHaveBeenCalledTimes(6);
    await expect(Promise.all(results)).resolves.toEqual([
      validStructuredResponse,
      validStructuredResponse,
      validStructuredResponse,
    ]);
  });
});

function clientFromCreate(create: AnthropicCreate): AnthropicClient {
  return { messages: { create } };
}

function createMessageSequence(outcomes: ReadonlyArray<unknown>): AnthropicCreate {
  const pending = [...outcomes];

  return vi.fn<AnthropicCreate>(async () => {
    const outcome = pending.shift();

    if (outcome instanceof Error) {
      throw outcome;
    }

    return outcome;
  });
}

function createDelayedErrorSequence(
  outcomes: ReadonlyArray<{ readonly responseMs: number; readonly error: Error }>,
): AnthropicCreate {
  const pending = [...outcomes];

  return vi.fn<AnthropicCreate>(async () => {
    const outcome = pending.shift();

    if (outcome === undefined) {
      return anthropicMessage();
    }

    await sleep(outcome.responseMs);
    throw outcome.error;
  });
}

type TerminalFailureMode = "exhausted-503" | "immediate-401" | "timeout";

function createTerminalFailure(mode: TerminalFailureMode): AnthropicCreate {
  switch (mode) {
    case "exhausted-503":
      return createDelayedErrorSequence([
        { responseMs: 40, error: apiError(503) },
        { responseMs: 55, error: apiError(503) },
        { responseMs: 70, error: apiError(503) },
      ]);
    case "immediate-401":
      return createDelayedErrorSequence([{ responseMs: 30, error: apiError(401) }]);
    case "timeout":
      return vi.fn<AnthropicCreate>(async (_request, options) => waitForAbort(options));
  }
}

async function advanceTerminalFailureTimers(mode: TerminalFailureMode): Promise<void> {
  switch (mode) {
    case "exhausted-503":
      await vi.advanceTimersByTimeAsync(40);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(55);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(70);
      return;
    case "immediate-401":
      await vi.advanceTimersByTimeAsync(30);
      return;
    case "timeout":
      await vi.advanceTimersByTimeAsync(200);
      return;
  }
}

function apiError(status: number): APIError {
  return APIError.generate(
    status,
    { type: "error", error: { type: "api_error", message: `HTTP ${String(status)}` } },
    `HTTP ${String(status)}`,
    new Headers(),
  );
}

function anthropicMessage() {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: TestModel,
    content: [{ type: "text", text: JSON.stringify(validStructuredResponse) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 42, output_tokens: 24 },
  };
}

function waitForAbort(options: AnthropicCreateOptions): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (options?.signal?.aborted === true) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    options?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted.", "AbortError")),
      { once: true },
    );
  });
}

function waitForResponseOrAbort(
  responseMs: number,
  options: AnthropicCreateOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted === true) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    options?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted.", "AbortError")),
      { once: true },
    );
    setTimeout(() => resolve(anthropicMessage()), responseMs);
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error("Expected promise to reject with an Error");
}

function expectAttemptDurationCount(error: Error, expectedCount: number): void {
  if (!("attemptDurationsMs" in error) || !Array.isArray(error.attemptDurationsMs)) {
    throw new Error("Expected error to include attempt durations");
  }

  expect(error.attemptDurationsMs).toHaveLength(expectedCount);
}
