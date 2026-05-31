// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { APIConnectionError, APIError } from "openai";
import { describe, expect, it } from "vitest";

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
  new (options: { readonly apiKey: string; readonly client: FakeOpenAIChatClient }): LLMProvider;
}

const validParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: LlmProviders.LLMResponseSchema,
};

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
    const provider = newProviderRejecting(sdkError);

    const error = await captureAsyncOpenAIProviderError(provider.generateStructured(validParams));

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).not.toBeInstanceOf(OpenAIProviderAuthError);
    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("request failed");
    expect(error.cause).toBe(sdkError);
  });
});

function newProviderRejecting(error: Error): LLMProvider {
  const Provider = openAIProviderConstructor();

  return new Provider({
    apiKey: TestApiKey,
    client: fakeOpenAIClientRejecting(error),
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
  return {
    chat: {
      completions: {
        create: async () => {
          throw error;
        },
      },
    },
  };
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
