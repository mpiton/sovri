// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { APIConnectionError, APIError } from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProviderAuthError, OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-key";

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAIProviderConstructor {
  new (options: {
    readonly apiKey: string;
    readonly maxAttempts?: number;
    readonly client: FakeOpenAIChatClient;
  }): LLMProvider;
}

const validParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: LlmProviders.LLMResponseSchema,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("OpenAIProvider SDK errors", () => {
  it("wraps OpenAI authentication failures as typed auth errors", async () => {
    const sdkError = APIError.generate(
      401,
      { error: { message: "Invalid API key", code: "invalid_api_key" } },
      "Unauthorized",
      new Headers({ "x-request-id": "req_test" }),
    );
    const provider = newProviderRejecting(sdkError);

    const error = await captureAsyncOpenAIProviderError(provider.generateStructured(validParams));

    expect(error).toBeInstanceOf(OpenAIProviderAuthError);
    expect(error.name).toBe("OpenAIProviderAuthError");
    expect(error.status).toBe(401);
    expect(error.requestId).toBe("req_test");
    expect(error.code).toBe("invalid_api_key");
    expect(error.cause).toBe(sdkError);
  });

  it("wraps OpenAI connection failures as typed provider errors", async () => {
    const sdkError = new APIConnectionError({ message: "Network unavailable" });
    const provider = newProviderRejecting(sdkError, 1);

    const error = await captureAsyncOpenAIProviderError(provider.generateStructured(validParams));

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).not.toBeInstanceOf(OpenAIProviderAuthError);
    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("failed after 1 attempts");
    expect(error.cause).toBe(sdkError);
  });

  it("honors maxAttempts for retryable OpenAI failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sdkError = APIError.generate(
      429,
      { error: { message: "Rate limited", code: "rate_limit" } },
      "Rate limited",
      new Headers({ "x-request-id": "req_retry" }),
    );
    const create = vi.fn(async () => {
      throw sdkError;
    });
    const Provider = openAIProviderConstructor();
    const provider = new Provider({
      apiKey: TestApiKey,
      client: fakeOpenAIClientWithCreate(create),
      maxAttempts: 2,
    });

    const result = provider.generateStructured(validParams);
    const capturedError = captureAsyncOpenAIProviderError(result);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);

    const error = await capturedError;
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error.message).toContain("2 attempts");
    expect(error.status).toBe(429);
    expect(error.requestId).toBe("req_retry");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

function newProviderRejecting(error: Error, maxAttempts?: number): LLMProvider {
  const Provider = openAIProviderConstructor();

  return new Provider({
    apiKey: TestApiKey,
    client: fakeOpenAIClientRejecting(error),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
  });
}

function openAIProviderConstructor(): OpenAIProviderConstructor {
  const exportedProvider = Reflect.get(LlmProviders, "OpenAIProvider");
  if (!isOpenAIProviderConstructor(exportedProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }

  return exportedProvider;
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function fakeOpenAIClientRejecting(error: Error): FakeOpenAIChatClient {
  return fakeOpenAIClientWithCreate(async () => {
    throw error;
  });
}

function fakeOpenAIClientWithCreate(
  create: (request: unknown, options?: unknown) => Promise<unknown>,
): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create,
      },
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function captureAsyncOpenAIProviderError(
  promise: Promise<unknown>,
): Promise<OpenAIProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenAIProviderError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected OpenAIProviderError");
}
