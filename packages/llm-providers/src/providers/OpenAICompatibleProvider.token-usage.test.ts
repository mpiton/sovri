// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-compatible-key";
const TestBaseUrl = "https://ollama.eu.example/v1";
const ReviewedContent = '{"summary":"Reviewed"}';
const MissingUsage = Symbol("missing OpenAI-compatible usage");

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

interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly client: FakeOpenAIChatClient;
}

interface OpenAICompatibleProviderExports {
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
}

const InvalidUsageShapes = [
  ["missing", MissingUsage],
  ['{"prompt_tokens":321}', { prompt_tokens: 321 }],
  ['{"prompt_tokens":321,"completion_tokens":-1}', { prompt_tokens: 321, completion_tokens: -1 }],
  [
    '{"prompt_tokens":"321","completion_tokens":54}',
    {
      prompt_tokens: "321",
      completion_tokens: 54,
    },
  ],
] satisfies ReadonlyArray<readonly [string, UsageShape]>;

describe("OpenAI-compatible token usage parity", () => {
  it("returns parsed data and shared token usage from generateStructuredWithUsage", async () => {
    // Given an OpenAI-compatible provider is constructed with apiKey "test-openai-compatible-key", baseUrl "https://ollama.eu.example/v1", and an injected fake client
    // And the caller Zod schema requires {"summary": string}
    // Given the fake compatible response content is "{\"summary\":\"Reviewed\"}"
    // And usage.prompt_tokens is 321
    // And usage.completion_tokens is 54
    const provider = await newProvider(openAIResponse(ReviewedContent, compatibleTokenUsage()));

    // When generateStructuredWithUsage is called
    const result = await generateStructuredWithUsage<ReviewData>(provider);

    // Then data equals {"summary":"Reviewed"}
    // And tokenUsage equals {"prompt":321,"completion":54}
    expect(result.data).toEqual({ summary: "Reviewed" });
    expect(result.tokenUsage).toEqual({ prompt: 321, completion: 54 });
  });

  it.each(InvalidUsageShapes)(
    "throws the OpenAI typed provider error for usage shape %s",
    async (_usageShape, usage) => {
      // Given an OpenAI-compatible provider is constructed with apiKey "test-openai-compatible-key", baseUrl "https://ollama.eu.example/v1", and an injected fake client
      // And the caller Zod schema requires {"summary": string}
      // Given the fake compatible response content is "{\"summary\":\"Reviewed\"}"
      // And the fake compatible response usage is "<usage_shape>"
      const provider = await newProvider(openAIResponse(ReviewedContent, usage));

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
    // Given an OpenAI-compatible provider is constructed with apiKey "test-openai-compatible-key", baseUrl "https://ollama.eu.example/v1", and an injected fake client
    // And the caller Zod schema requires {"summary": string}
    // Given the fake compatible response content is "{\"summary\":\"Reviewed\"}"
    // And usage.prompt_tokens is 321
    // And usage.completion_tokens is 54
    const provider = await newProvider(openAIResponse(ReviewedContent, compatibleTokenUsage()));

    // When generateStructured is called
    const data = await provider.generateStructured(ReviewParams);

    // Then the returned value equals {"summary":"Reviewed"}
    // And the returned value does not contain "tokenUsage"
    expect(data).toEqual({ summary: "Reviewed" });
    expect(Reflect.has(data, "tokenUsage")).toBe(false);
  });
});

async function newProvider(response: unknown): Promise<LLMProvider> {
  const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

  return createOpenAICompatibleProvider({
    apiKey: TestApiKey,
    baseUrl: TestBaseUrl,
    client: fakeOpenAIClient(response),
  });
}

async function openAICompatibleProviderExports(): Promise<OpenAICompatibleProviderExports> {
  const module = await import("../index.js");
  const createOpenAICompatibleProvider = Reflect.get(module, "createOpenAICompatibleProvider");

  if (typeof createOpenAICompatibleProvider !== "function") {
    throw new Error("createOpenAICompatibleProvider export is missing");
  }

  return { createOpenAICompatibleProvider };
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

function compatibleTokenUsage(): unknown {
  return {
    prompt_tokens: 321,
    completion_tokens: 54,
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
