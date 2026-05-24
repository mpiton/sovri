// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { HttpResponse } from "msw";
import { vi } from "vitest";

import { LLMResponseSchema, type LLMResponse } from "../schemas/LLMResponseSchema.js";
import type { MistralProviderOptions } from "./MistralProvider.js";

export const TestApiKey = "test-key";
export const TestModel = "codestral-latest";
export const TestMaxTokens = 512;
export const validStructuredResponse: LLMResponse = {
  summary: "The diff looks safe.",
  findings: [],
  walkthrough_markdown: "Reviewed the auth handler changes.",
};

export const generateParams = {
  systemPrompt: "Return a structured review.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: LLMResponseSchema,
  maxTokens: TestMaxTokens,
  temperature: 0,
};

export type MistralClient = NonNullable<MistralProviderOptions["client"]>;
export type MistralComplete = MistralClient["chat"]["complete"];
export type MistralRequestOptions = Parameters<MistralComplete>[1];

export function fakeClient(): MistralClient {
  return clientFromComplete(vi.fn<MistralComplete>());
}

export function clientFromComplete(complete: MistralComplete): MistralClient {
  return { chat: { complete } };
}

export function mistralCompletion(
  data: unknown,
  usage = { promptTokens: 42, completionTokens: 24 },
) {
  return {
    id: "cmpl_test",
    object: "chat.completion",
    model: TestModel,
    created: 0,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(data) },
        finishReason: "stop",
      },
    ],
    usage,
  };
}

export function mistralHttpResponse(data: unknown) {
  return HttpResponse.json({
    id: "cmpl_test",
    object: "chat.completion",
    model: TestModel,
    created: 0,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(data) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  });
}

export class FakeMistralHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`HTTP ${String(statusCode)}`);
    this.statusCode = statusCode;
  }
}

export class FakeConnectionError extends Error {
  override readonly name = "ConnectionError";
}

export class FakeRequestTimeoutError extends Error {
  override readonly name = "RequestTimeoutError";
}

export async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error("Expected promise to reject with an Error");
}

export function waitForAbort(options: MistralRequestOptions): Promise<never> {
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

export function waitForResponseOrAbort(
  responseMs: number,
  options: MistralRequestOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted === true) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    options?.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      options?.signal?.removeEventListener("abort", onAbort);
      resolve(mistralCompletion(validStructuredResponse));
    }, responseMs);
  });
}
