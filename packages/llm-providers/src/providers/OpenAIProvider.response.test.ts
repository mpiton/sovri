// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-key";

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAIProviderRuntimeOptions {
  readonly apiKey: string;
  readonly client: FakeOpenAIChatClient;
}

interface OpenAIProviderConstructor {
  new (options: OpenAIProviderRuntimeOptions): LLMProvider;
}

const validParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: z.strictObject({ summary: z.string() }),
};

describe("OpenAIProvider response validation", () => {
  it("throws a typed provider error when token usage is missing", async () => {
    const provider = newProvider(
      openAICompletion({
        choices: [{ message: { content: JSON.stringify({ summary: "Reviewed" }) } }],
      }),
    );

    const error = await captureAsyncOpenAIProviderError(
      generateStructuredWithUsage(provider, validParams),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("token usage");
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it("marks schema mismatches as retryable and keeps token usage", async () => {
    const provider = newProvider(openAICompletionWithData({ summary: 123 }));

    const error = await captureAsyncOpenAIProviderError(
      generateStructuredWithUsage(provider, validParams),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("schema validation");
    expect(error.retryableWithCorrectivePrompt).toBe(true);
    expect(error.tokenUsage).toEqual({ prompt: 123, completion: 45 });
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it("throws a typed provider error when choices are missing", async () => {
    const provider = newProvider(openAICompletion({ usage: openAITokenUsage() }));

    const error = await captureAsyncOpenAIProviderError(
      generateStructuredWithUsage(provider, validParams),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("choices");
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it("throws a typed provider error when text content is empty", async () => {
    const provider = newProvider(
      openAICompletion({
        choices: [{ message: { content: "   " } }],
        usage: openAITokenUsage(),
      }),
    );

    const error = await captureAsyncOpenAIProviderError(
      generateStructuredWithUsage(provider, validParams),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("text content");
  });

  it("throws a typed provider error when text content is not valid JSON", async () => {
    const provider = newProvider(
      openAICompletion({
        choices: [{ message: { content: "not-json" } }],
        usage: openAITokenUsage(),
      }),
    );

    const error = await captureAsyncOpenAIProviderError(
      generateStructuredWithUsage(provider, validParams),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("valid JSON");
  });
});

function newProvider(response: unknown): LLMProvider {
  const Provider = openAIProviderConstructor();

  return new Provider({
    apiKey: TestApiKey,
    client: fakeOpenAIClient(response),
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

function fakeOpenAIClient(response: unknown): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          return response;
        },
      },
    },
  };
}

function openAICompletionWithData(data: unknown): unknown {
  return openAICompletion({
    choices: [{ message: { content: JSON.stringify(data) } }],
    usage: openAITokenUsage(),
  });
}

function openAICompletion(response: unknown): unknown {
  return response;
}

function openAITokenUsage(): unknown {
  return {
    prompt_tokens: 123,
    completion_tokens: 45,
  };
}

function generateStructuredWithUsage(
  provider: LLMProvider,
  params: Parameters<LLMProvider["generateStructured"]>[0],
): Promise<unknown> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage(params);
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
