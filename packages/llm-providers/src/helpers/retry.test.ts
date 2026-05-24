// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  retryWithBackoff,
  RetryExhaustedError,
  RetryTimeoutError,
  type AttemptContext,
  type RetryOptions,
} from "./retry.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("retryWithBackoff — happy first attempt", () => {
  it("returns the first attempt result without retrying or sleeping between attempts", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 60000 ms
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 60_000,
      isRetryable: () => false,
    };

    // And the operation resolves with value "ok" on the first attempt
    const captured: AttemptContext[] = [];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      captured.push(ctx);
      return "ok";
    });

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    // When the caller invokes the retry helper once
    const result = await retryWithBackoff(fn, opts);

    // Then the retry helper returns "ok"
    expect(result).toBe("ok");

    // And exactly 1 attempt is executed
    expect(fn).toHaveBeenCalledTimes(1);

    // And the AttemptContext captured on attempt 1 reports attempt number 1
    expect(captured[0]?.attempt).toBe(1);

    // And the AttemptContext captured on attempt 1 reports a remaining budget of 60000 ms
    expect(captured[0]?.timeoutMs).toBe(60_000);

    // And the AttemptContext captured on attempt 1 has a fresh, non-aborted AbortSignal
    expect(captured[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(captured[0]?.signal.aborted).toBe(false);

    // And the retry helper does not sleep between attempts
    //   (any setTimeout scheduled with a delay shorter than the per-attempt
    //   budget would indicate a retry sleep; only the per-attempt deadline
    //   timer, scheduled for `opts.timeoutMs`, is allowed)
    const shortDelayCalls = setTimeoutSpy.mock.calls.filter((args) => {
      const delay = args[1];
      return typeof delay === "number" && delay < opts.timeoutMs;
    });
    expect(shortDelayCalls).toEqual([]);
  });
});

describe("retryWithBackoff — retry then success", () => {
  it("retries one retryable failure and resolves on the next attempt", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 60000 ms
    // And the isRetryable predicate classifies error "E_TRANSIENT" as retryable
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 60_000,
      isRetryable: (err) => err instanceof Error && err.message === "E_TRANSIENT",
    };

    // And the jitter factor selected for the first retry delay is 0 percent
    //   (jitter formula `(Math.random() * 2 - 1) * 0.2` yields a 0 percent
    //   factor when Math.random returns 0.5, leaving the nominal 500 ms
    //   backoff unchanged)
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // And the first attempt rejects with error "E_TRANSIENT"
    // And the second attempt resolves with value "ok"
    const captured: AttemptContext[] = [];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      captured.push(ctx);
      if (ctx.attempt === 1) {
        throw new Error("E_TRANSIENT");
      }
      return "ok";
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);
    await Promise.resolve();
    await Promise.resolve();

    // First attempt ran and rejected; backoff is pending.
    expect(fn).toHaveBeenCalledTimes(1);

    // Then the retry helper waits 500 ms between the first and the second attempt
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    // And exactly 2 attempts are executed
    expect(fn).toHaveBeenCalledTimes(2);

    // And the retry helper returns "ok"
    const result = await promise;
    expect(result).toBe("ok");

    // And the AttemptContext captured on attempt 2 reports attempt number 2
    expect(captured[1]?.attempt).toBe(2);
  });

  it.each([
    "HTTP_408",
    "HTTP_409",
    "HTTP_429",
    "HTTP_500",
    "HTTP_502",
    "HTTP_503",
    "HTTP_504",
    "HTTP_529",
    "TRANSPORT",
  ])(
    "retries caller-classified retryable error %s once and resolves on the next attempt",
    async (errorToken) => {
      // Given the retry helper is configured with max 3 total attempts
      // And the retry helper is configured with a base delay of 500 ms
      // And the retry helper is configured with a timeout of 60000 ms
      // And the isRetryable predicate classifies error "<error_token>" as retryable
      const opts: RetryOptions = {
        maxAttempts: 3,
        baseDelayMs: 500,
        timeoutMs: 60_000,
        isRetryable: (err) => err instanceof Error && err.message === errorToken,
      };

      // And the jitter factor selected for the first retry delay is 0 percent
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      // And the first attempt rejects with error "<error_token>"
      // And the second attempt resolves with value "ok"
      const fn = vi.fn(async (ctx: AttemptContext) => {
        if (ctx.attempt === 1) {
          throw new Error(errorToken);
        }
        return "ok";
      });

      // When the caller invokes the retry helper once
      const promise = retryWithBackoff(fn, opts);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);

      // Then the retry helper returns "ok"
      const result = await promise;
      expect(result).toBe("ok");

      // And exactly 2 attempts are executed
      expect(fn).toHaveBeenCalledTimes(2);
    },
  );
});

describe("retryWithBackoff — non-retryable rethrow", () => {
  it("rethrows the original non-retryable error without wrapping", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 60000 ms
    // And the isRetryable predicate classifies error "E_AUTH" as non-retryable
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 60_000,
      isRetryable: (err) => err instanceof Error && err.message !== "E_AUTH",
    };

    // And the first attempt rejects with error "E_AUTH"
    const eAuth = new Error("E_AUTH");
    const fn = vi.fn(async () => {
      throw eAuth;
    });

    // When the caller invokes the retry helper once
    const capturedError: unknown = await retryWithBackoff(fn, opts).catch(
      (error: unknown) => error,
    );

    // Then the retry helper rethrows the original "E_AUTH" error
    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toBe("E_AUTH");

    // And the rethrown error is the same object reference as the rejected cause
    expect(capturedError).toBe(eAuth);

    // And exactly 1 attempt is executed
    expect(fn).toHaveBeenCalledTimes(1);

    // And the rethrown error is not an instance of RetryExhaustedError
    expect(capturedError).not.toBeInstanceOf(RetryExhaustedError);

    // And the rethrown error is not an instance of RetryTimeoutError
    expect(capturedError).not.toBeInstanceOf(RetryTimeoutError);
  });
});
