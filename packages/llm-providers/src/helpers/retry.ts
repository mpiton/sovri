// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export interface AttemptContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly attempt: number;
}

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly timeoutMs: number;
  readonly isRetryable: (err: unknown) => boolean;
}

export interface RetryErrorOptions {
  readonly cause: unknown;
  readonly attemptDurationsMs: ReadonlyArray<number>;
}

export class RetryExhaustedError extends Error {
  override readonly name = "RetryExhaustedError";
  override readonly cause: unknown;
  readonly attemptDurationsMs: ReadonlyArray<number>;

  constructor(message: string, options: RetryErrorOptions) {
    super(message);
    this.cause = options.cause;
    this.attemptDurationsMs = options.attemptDurationsMs;
  }
}

export class RetryTimeoutError extends Error {
  override readonly name = "RetryTimeoutError";
  override readonly cause: unknown;
  readonly attemptDurationsMs: ReadonlyArray<number>;

  constructor(message: string, options: RetryErrorOptions) {
    super(message);
    this.cause = options.cause;
    this.attemptDurationsMs = options.attemptDurationsMs;
  }
}

const RETRY_JITTER_RATIO = 0.2;

export async function retryWithBackoff<T>(
  fn: (ctx: AttemptContext) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  return runAttempt(fn, opts, 1);
}

async function runAttempt<T>(
  fn: (ctx: AttemptContext) => Promise<T>,
  opts: RetryOptions,
  attempt: number,
): Promise<T> {
  const controller = new AbortController();

  try {
    return await fn({
      signal: controller.signal,
      timeoutMs: opts.timeoutMs,
      attempt,
    });
  } catch {
    await sleep(nextRetryDelayMs(opts.baseDelayMs, attempt));
    return runAttempt(fn, opts, attempt + 1);
  }
}

function nextRetryDelayMs(baseDelayMs: number, completedAttempt: number): number {
  const nominalDelayMs = baseDelayMs * 2 ** (completedAttempt - 1);
  const jitterFactor = (Math.random() * 2 - 1) * RETRY_JITTER_RATIO;

  return Math.round(nominalDelayMs * (1 + jitterFactor));
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
