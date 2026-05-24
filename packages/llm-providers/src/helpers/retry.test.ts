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

  it.each(["HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_422"])(
    "rethrows non-retryable HTTP token %s verbatim without wrapping",
    async (errorToken) => {
      // Given the retry helper is configured with max 3 total attempts
      // And the retry helper is configured with a base delay of 500 ms
      // And the retry helper is configured with a timeout of 60000 ms
      // And the isRetryable predicate classifies error "<error_token>" as non-retryable
      const opts: RetryOptions = {
        maxAttempts: 3,
        baseDelayMs: 500,
        timeoutMs: 60_000,
        isRetryable: (err) => err instanceof Error && err.message !== errorToken,
      };

      // And the first attempt rejects with error "<error_token>"
      const cause = new Error(errorToken);
      const fn = vi.fn(async () => {
        throw cause;
      });

      // When the caller invokes the retry helper once
      const capturedError: unknown = await retryWithBackoff(fn, opts).catch(
        (error: unknown) => error,
      );

      // Then the retry helper rethrows the original "<error_token>" error
      expect(capturedError).toBe(cause);
      // And exactly 1 attempt is executed
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );
});

describe("retryWithBackoff — timeout deadline abort", () => {
  it("aborts the operation and throws RetryTimeoutError when the deadline expires during the first attempt", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 200 ms
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 200,
      isRetryable: () => false,
    };

    vi.useFakeTimers();

    // And the operation never resolves on its own and instead awaits its AttemptContext AbortSignal
    const captured: AttemptContext[] = [];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      captured.push(ctx);
      return new Promise<never>((_, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);
    const capturedError = promise.catch((error: unknown) => error);

    await Promise.resolve();
    await Promise.resolve();

    // First attempt has started and its signal is not yet aborted
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captured[0]?.signal.aborted).toBe(false);

    // And 200 ms elapse
    await vi.advanceTimersByTimeAsync(200);

    // Then the AttemptContext captured on attempt 1 has an AbortSignal that becomes aborted at 200 ms
    expect(captured[0]?.signal.aborted).toBe(true);

    // And the retry helper throws RetryTimeoutError
    const error = await capturedError;
    expect(error).toBeInstanceOf(RetryTimeoutError);

    // And the RetryTimeoutError message is "Operation timed out after 200 ms"
    expect((error as RetryTimeoutError).message).toBe("Operation timed out after 200 ms");

    // And the RetryTimeoutError exposes attemptDurationsMs of length 1
    expect((error as RetryTimeoutError).attemptDurationsMs).toHaveLength(1);

    // And exactly 1 attempt is executed
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws RetryTimeoutError carrying the rejected cause when remaining budget cannot fit the backoff", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 800 ms
    // And the isRetryable predicate classifies error "E_TRANSIENT" as retryable
    // And the jitter factor selected for the first retry delay is 0 percent
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 800,
      isRetryable: (err) => err instanceof Error && err.message === "E_TRANSIENT",
    };

    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // And the first attempt rejects with error "E_TRANSIENT" after 600 ms
    const eTransient = new Error("E_TRANSIENT");
    const fn = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 600);
      });
      throw eTransient;
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);
    const capturedError = promise.catch((error: unknown) => error);

    // 600 ms elapse: attempt 1 finishes rejecting after the configured delay
    await vi.advanceTimersByTimeAsync(600);

    // The next attempt's nominal sleep is 500 ms but the remaining budget is
    // only 200 ms, so the helper must surface the timeout without scheduling
    // the retry. Advance past the would-be sleep boundary anyway to flush any
    // pending microtask the impl may have queued.
    await vi.advanceTimersByTimeAsync(500);

    // Then the retry helper throws RetryTimeoutError
    const error = await capturedError;
    expect(error).toBeInstanceOf(RetryTimeoutError);

    // And exactly 1 attempt is executed
    expect(fn).toHaveBeenCalledTimes(1);

    // And the RetryTimeoutError exposes attemptDurationsMs equal to [600]
    expect((error as RetryTimeoutError).attemptDurationsMs).toEqual([600]);

    // And the RetryTimeoutError carries the rejected "E_TRANSIENT" error as cause
    expect((error as RetryTimeoutError).cause).toBe(eTransient);
  });

  it.each([
    { responseMs: 999, outcome: "success" as const },
    { responseMs: 1000, outcome: "success" as const },
    { responseMs: 1001, outcome: "RetryTimeoutError" as const },
  ])(
    "handles boundary response at $responseMs ms as $outcome (timeout 1000 ms)",
    async ({ responseMs, outcome }) => {
      // Given the retry helper is configured with max 3 total attempts
      // And the retry helper is configured with a base delay of 500 ms
      // And the retry helper is configured with a timeout of 1000 ms
      const opts: RetryOptions = {
        maxAttempts: 3,
        baseDelayMs: 500,
        timeoutMs: 1000,
        isRetryable: () => false,
      };

      vi.useFakeTimers();

      // And the operation resolves with value "ok" after <response_ms> ms
      //   (or rejects via the AbortSignal if the abort fires first)
      const fn = vi.fn(
        (ctx: AttemptContext) =>
          new Promise<string>((resolve, reject) => {
            if (ctx.signal.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            ctx.signal.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
            setTimeout(() => resolve("ok"), responseMs);
          }),
      );

      // When the caller invokes the retry helper once
      // And <response_ms> ms elapse
      const promise = retryWithBackoff(fn, opts);
      const capturedError =
        outcome === "RetryTimeoutError" ? promise.catch((error: unknown) => error) : undefined;
      await vi.advanceTimersByTimeAsync(responseMs);

      // Then the retry helper outcome is "<outcome>"
      if (outcome === "success") {
        await expect(promise).resolves.toBe("ok");
      } else {
        expect(await capturedError).toBeInstanceOf(RetryTimeoutError);
      }
    },
  );
});

describe("retryWithBackoff — attempts cap exhausted", () => {
  it("throws RetryExhaustedError after maxAttempts retryable failures", async () => {
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

    // And the jitter factor selected for every retry delay is 0 percent
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // And every attempt rejects with error "E_TRANSIENT"
    const transientErrors = [
      new Error("E_TRANSIENT"),
      new Error("E_TRANSIENT"),
      new Error("E_TRANSIENT"),
    ];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      throw transientErrors[ctx.attempt - 1] ?? new Error("E_TRANSIENT");
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);
    const capturedError = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(500); // first retry sleep (500 ms * 2^0)
    await vi.advanceTimersByTimeAsync(1000); // second retry sleep (500 ms * 2^1)

    // Then the retry helper throws RetryExhaustedError
    const error = await capturedError;
    expect(error).toBeInstanceOf(RetryExhaustedError);

    // And the RetryExhaustedError message is "Operation failed after 3 attempts"
    expect((error as RetryExhaustedError).message).toBe("Operation failed after 3 attempts");

    // And the RetryExhaustedError exposes attemptDurationsMs of length 3
    expect((error as RetryExhaustedError).attemptDurationsMs).toHaveLength(3);

    // And the RetryExhaustedError carries the last "E_TRANSIENT" error as cause
    expect((error as RetryExhaustedError).cause).toBe(transientErrors[2]);

    // And exactly 3 attempts are executed
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("preserves every per-attempt duration when retries are exhausted", async () => {
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

    // And the jitter factor selected for every retry delay is 0 percent
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // And the first attempt rejects after 40 ms
    // And the second attempt rejects after 55 ms
    // And the third attempt rejects after 70 ms
    const attemptDelays = [40, 55, 70];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      const delay = attemptDelays[ctx.attempt - 1] ?? 0;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
      throw new Error("E_TRANSIENT");
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);
    const capturedError = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(40); // attempt 1 duration
    await vi.advanceTimersByTimeAsync(500); // first retry sleep
    await vi.advanceTimersByTimeAsync(55); // attempt 2 duration
    await vi.advanceTimersByTimeAsync(1000); // second retry sleep
    await vi.advanceTimersByTimeAsync(70); // attempt 3 duration

    // Then the retry helper throws RetryExhaustedError
    const error = await capturedError;
    expect(error).toBeInstanceOf(RetryExhaustedError);

    // And the RetryExhaustedError exposes attemptDurationsMs equal to [40, 55, 70]
    expect((error as RetryExhaustedError).attemptDurationsMs).toEqual([40, 55, 70]);

    // And exactly 3 attempts are executed
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it.each([
    { randomValue: 0, jitterPercent: -20, delayMs: 400 },
    { randomValue: 0.5, jitterPercent: 0, delayMs: 500 },
    { randomValue: 1, jitterPercent: 20, delayMs: 600 },
  ])(
    "first retry delay is $delayMs ms when jitter is $jitterPercent percent",
    async ({ randomValue, delayMs }) => {
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

      // And the jitter factor selected for the first retry delay is <jitter_percent> percent
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(randomValue);

      // And the first attempt rejects with error "E_TRANSIENT"
      // And the second attempt resolves with value "ok"
      const fn = vi.fn(async (ctx: AttemptContext) => {
        if (ctx.attempt === 1) {
          throw new Error("E_TRANSIENT");
        }
        return "ok";
      });

      // When the caller invokes the retry helper once
      const promise = retryWithBackoff(fn, opts);
      await Promise.resolve();
      await Promise.resolve();

      // Then the retry helper waits <delay_ms> ms between the first and the second attempt
      await vi.advanceTimersByTimeAsync(delayMs - 1);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      // And the retry helper returns "ok"
      await expect(promise).resolves.toBe("ok");

      // And exactly 2 attempts are executed
      expect(fn).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { firstRandom: 0, secondRandom: 1, firstDelay: 400, secondDelay: 1200 },
    { firstRandom: 1, secondRandom: 0, firstDelay: 600, secondDelay: 800 },
  ])(
    "second retry delay is $secondDelay ms when first jitter is $firstRandom and second jitter is $secondRandom",
    async ({ firstRandom, secondRandom, firstDelay, secondDelay }) => {
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

      // And the jitter factor selected for the first retry delay is <first_jitter_percent> percent
      // And the jitter factor selected for the second retry delay is <second_jitter_percent> percent
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValueOnce(firstRandom).mockReturnValueOnce(secondRandom);

      // And the first attempt rejects with error "E_TRANSIENT"
      // And the second attempt rejects with error "E_TRANSIENT"
      // And the third attempt resolves with value "ok"
      const fn = vi.fn(async (ctx: AttemptContext) => {
        if (ctx.attempt <= 2) {
          throw new Error("E_TRANSIENT");
        }
        return "ok";
      });

      // When the caller invokes the retry helper once
      const promise = retryWithBackoff(fn, opts);
      await Promise.resolve();
      await Promise.resolve();

      // Then the retry helper waits <first_delay_ms> ms between attempts 1 and 2
      await vi.advanceTimersByTimeAsync(firstDelay - 1);
      expect(fn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(2);

      // And the retry helper waits <second_delay_ms> ms between attempts 2 and 3
      await vi.advanceTimersByTimeAsync(secondDelay - 1);
      expect(fn).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);

      // And exactly 3 attempts are executed
      await expect(promise).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    },
  );

  it.each([1, 2, 3, 5])(
    "respects the maxAttempts cap when configured to %i total attempts",
    async (maxAttempts) => {
      // Given the retry helper is configured with max <max_attempts> total attempts
      // And the retry helper is configured with a base delay of 1 ms
      // And the retry helper is configured with a timeout of 60000 ms
      // And the isRetryable predicate classifies error "E_TRANSIENT" as retryable
      const opts: RetryOptions = {
        maxAttempts,
        baseDelayMs: 1,
        timeoutMs: 60_000,
        isRetryable: (err) => err instanceof Error && err.message === "E_TRANSIENT",
      };

      // And the jitter factor selected for every retry delay is 0 percent
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      // And every attempt rejects with error "E_TRANSIENT"
      const fn = vi.fn(async () => {
        throw new Error("E_TRANSIENT");
      });

      // When the caller invokes the retry helper once
      const promise = retryWithBackoff(fn, opts);
      const capturedError = promise.catch((error: unknown) => error);

      // Advance through every retry sleep (1, 2, 4, 8 ... ms for maxAttempts up to 5)
      for (let attempt = 1; attempt < maxAttempts; attempt++) {
        await vi.advanceTimersByTimeAsync(2 ** (attempt - 1));
      }

      // Then the retry helper throws RetryExhaustedError
      const error = await capturedError;
      expect(error).toBeInstanceOf(RetryExhaustedError);

      // And exactly <max_attempts> attempts are executed
      expect(fn).toHaveBeenCalledTimes(maxAttempts);

      // And the RetryExhaustedError exposes attemptDurationsMs of length <max_attempts>
      expect((error as RetryExhaustedError).attemptDurationsMs).toHaveLength(maxAttempts);
    },
  );
});

describe("retryWithBackoff — per-attempt budget", () => {
  it("forwards the full configured timeout to AttemptContext on the first attempt", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 5000 ms
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 5000,
      isRetryable: () => false,
    };

    // And the operation captures its AttemptContext on every attempt
    // And the operation resolves with value "ok" on the first attempt
    const captured: AttemptContext[] = [];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      captured.push(ctx);
      return "ok";
    });

    // When the caller invokes the retry helper once
    const result = await retryWithBackoff(fn, opts);

    // Then the retry helper returns "ok"
    expect(result).toBe("ok");

    // And the AttemptContext captured on attempt 1 reports a remaining budget of 5000 ms
    expect(captured[0]?.timeoutMs).toBe(5000);

    // And the AttemptContext captured on attempt 1 reports attempt number 1
    expect(captured[0]?.attempt).toBe(1);

    // And the AttemptContext captured on attempt 1 has a fresh, non-aborted AbortSignal
    expect(captured[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(captured[0]?.signal.aborted).toBe(false);
  });

  it("forwards the shrunken remaining budget to AttemptContext on the second attempt", async () => {
    // Given the retry helper is configured with max 3 total attempts
    // And the retry helper is configured with a base delay of 500 ms
    // And the retry helper is configured with a timeout of 5000 ms
    // And the isRetryable predicate classifies error "E_TRANSIENT" as retryable
    const opts: RetryOptions = {
      maxAttempts: 3,
      baseDelayMs: 500,
      timeoutMs: 5000,
      isRetryable: (err) => err instanceof Error && err.message === "E_TRANSIENT",
    };

    // And the jitter factor selected for the first retry delay is 0 percent
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // And the operation captures its AttemptContext on every attempt
    // And the first attempt rejects with error "E_TRANSIENT" after 800 ms
    // And the second attempt resolves with value "ok"
    const captured: AttemptContext[] = [];
    const fn = vi.fn(async (ctx: AttemptContext) => {
      captured.push(ctx);
      if (ctx.attempt === 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 800);
        });
        throw new Error("E_TRANSIENT");
      }
      return "ok";
    });

    // When the caller invokes the retry helper once
    const promise = retryWithBackoff(fn, opts);

    await vi.advanceTimersByTimeAsync(800); // attempt 1 duration
    await vi.advanceTimersByTimeAsync(500); // first retry sleep

    // Then the retry helper returns "ok"
    await expect(promise).resolves.toBe("ok");

    // And the AttemptContext captured on attempt 1 reports a remaining budget of 5000 ms
    expect(captured[0]?.timeoutMs).toBe(5000);

    // And the AttemptContext captured on attempt 2 reports a remaining budget of 3700 ms
    expect(captured[1]?.timeoutMs).toBe(3700);

    // And the AttemptContext captured on attempt 2 reports attempt number 2
    expect(captured[1]?.attempt).toBe(2);

    // And exactly 2 attempts are executed
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
