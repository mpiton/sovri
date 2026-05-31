// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-key";
const ReviewedContent = '{"summary":"Reviewed"}';
const MissingUsage = Symbol("missing OpenAI usage");

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

type ReviewData = z.infer<typeof ReviewParams.schema>;
type UsageShape = typeof MissingUsage | unknown;

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

const InvalidUsageShapes = [
  ["missing", MissingUsage],
  ['{"prompt_tokens":123}', { prompt_tokens: 123 }],
  ['{"prompt_tokens":123,"completion_tokens":-1}', { prompt_tokens: 123, completion_tokens: -1 }],
  [
    '{"prompt_tokens":"123","completion_tokens":45}',
    {
      prompt_tokens: "123",
      completion_tokens: 45,
    },
  ],
] satisfies ReadonlyArray<readonly [string, UsageShape]>;

describe("OpenAIProvider token usage acceptance", () => {
  it("returns prompt and completion tokens from generateStructuredWithUsage", async () => {
    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    // And the caller Zod schema requires {"summary": string}
    // Given the fake OpenAI response content is "{\"summary\":\"Reviewed\"}"
    // And usage.prompt_tokens is 123
    // And usage.completion_tokens is 45
    const provider = newProvider(openAIResponse(ReviewedContent, openAITokenUsage()));

    // When generateStructuredWithUsage is called
    const result = await generateStructuredWithUsage<ReviewData>(provider);

    // Then data equals {"summary":"Reviewed"}
    // And tokenUsage equals {"prompt":123,"completion":45}
    expect(result.data).toEqual({ summary: "Reviewed" });
    expect(result.tokenUsage).toEqual({ prompt: 123, completion: 45 });
  });

  it.each(InvalidUsageShapes)(
    "throws a typed provider error for usage shape %s",
    async (_usageShape, usage) => {
      // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
      // And the caller Zod schema requires {"summary": string}
      // Given the fake OpenAI response content is "{\"summary\":\"Reviewed\"}"
      // And the fake OpenAI response usage is "<usage_shape>"
      const provider = newProvider(openAIResponse(ReviewedContent, usage));

      // When generateStructuredWithUsage is called
      const error = await captureOpenAIProviderError(generateStructuredWithUsage(provider));

      // Then OpenAIProviderError is thrown
      // And the error message contains "OpenAI response did not contain valid token usage"
      // And the error exposes Zod issues
      expect(error).toBeInstanceOf(OpenAIProviderError);
      expect(error.message).toContain("OpenAI response did not contain valid token usage");
      expect(error.issues?.length).toBeGreaterThan(0);
    },
  );

  it("parses data from generateStructured without exposing usage metadata", async () => {
    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    // And the caller Zod schema requires {"summary": string}
    // Given the fake OpenAI response content is "{\"summary\":\"Reviewed\"}"
    // And usage.prompt_tokens is 123
    // And usage.completion_tokens is 45
    const provider = newProvider(openAIResponse(ReviewedContent, openAITokenUsage()));

    // When generateStructured is called
    const data = await provider.generateStructured(ReviewParams);

    // Then the returned value equals {"summary":"Reviewed"}
    // And the returned value does not contain "tokenUsage"
    expect(data).toEqual({ summary: "Reviewed" });
    expect(Reflect.has(data, "tokenUsage")).toBe(false);
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
        create: async () => response,
      },
    },
  };
}

function openAIResponse(content: string, usage: UsageShape): unknown {
  const response: Record<string, unknown> = {
    choices: [{ message: { content } }],
  };

  if (usage !== MissingUsage) {
    response["usage"] = usage;
  }

  return response;
}

function openAITokenUsage(): unknown {
  return {
    prompt_tokens: 123,
    completion_tokens: 45,
  };
}

function generateStructuredWithUsage<T>(provider: LLMProvider): Promise<StructuredGeneration<T>> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage<T>(ReviewParams);
}

async function captureOpenAIProviderError(promise: Promise<unknown>): Promise<OpenAIProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OpenAIProviderError) return error;
    throw error;
  }

  throw new Error("Expected OpenAIProviderError");
}
