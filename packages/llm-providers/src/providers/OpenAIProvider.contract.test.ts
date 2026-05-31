// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";
import * as LlmProviders from "../index.js";

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

describe("OpenAIProvider shared provider contract", () => {
  it("exports a provider with the shared LLMProvider metadata and methods", () => {
    // Given the package entrypoint is "packages/llm-providers/src/index.ts"
    // And the provider implementation file is "packages/llm-providers/src/providers/OpenAIProvider.ts"
    // And the default OpenAI model is "gpt-5.5"
    // And the default max token budget is 4096
    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    const exportedProvider = Reflect.get(LlmProviders, "OpenAIProvider");

    // When the provider metadata is inspected
    expect(isOpenAIProviderConstructor(exportedProvider)).toBe(true);
    if (!isOpenAIProviderConstructor(exportedProvider)) {
      throw new Error("OpenAIProvider export is missing");
    }

    const provider: LLMProvider = new exportedProvider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient({ summary: "Reviewed", findings: [] }),
    });

    // Then name equals "openai"
    // And model equals "gpt-5.5"
    // And maxTokens equals 4096
    // And generateStructured is a function
    // And generateStructuredWithUsage is a function
    // And the provider is assignable to the LLMProvider interface
    expect(provider.name).toBe("openai");
    expect(provider.model).toBe("gpt-5.5");
    expect(provider.maxTokens).toBe(4096);
    expect(provider.generateStructured).toEqual(expect.any(Function));
    expect(provider.generateStructuredWithUsage).toEqual(expect.any(Function));
  });

  it("keeps token usage on generateStructuredWithUsage and hides it from generateStructured", async () => {
    // Given the fake OpenAI client returns structured JSON {"summary":"Reviewed","findings":[]}
    // And the fake OpenAI client reports prompt token count 123
    // And the fake OpenAI client reports completion token count 45
    const exportedProvider = Reflect.get(LlmProviders, "OpenAIProvider");
    expect(isOpenAIProviderConstructor(exportedProvider)).toBe(true);
    if (!isOpenAIProviderConstructor(exportedProvider)) {
      throw new Error("OpenAIProvider export is missing");
    }
    const provider = new exportedProvider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient({ summary: "Reviewed", findings: [] }),
    });
    const params = {
      systemPrompt: "Review code safely.",
      userPrompt: "Diff contents",
      schema: z.strictObject({
        summary: z.string(),
        findings: z.array(z.unknown()),
      }),
    };

    // When generateStructuredWithUsage is called with a Zod schema for summary and findings
    const withUsage = await requireGenerateStructuredWithUsage(provider, params);

    // Then the result data equals {"summary":"Reviewed","findings":[]}
    // And tokenUsage equals {"prompt":123,"completion":45}
    expect(withUsage.data).toEqual({ summary: "Reviewed", findings: [] });
    expect(withUsage.tokenUsage).toEqual({ prompt: 123, completion: 45 });

    // When generateStructured is called with the same parameters
    const dataOnly = await provider.generateStructured(params);

    // Then the result equals {"summary":"Reviewed","findings":[]}
    // And the result does not expose tokenUsage
    expect(dataOnly).toEqual({ summary: "Reviewed", findings: [] });
    expect(Reflect.has(dataOnly, "tokenUsage")).toBe(false);
  });
});

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function fakeOpenAIClient(data: unknown): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(data) } }],
          usage: {
            prompt_tokens: 123,
            completion_tokens: 45,
          },
        }),
      },
    },
  };
}

async function requireGenerateStructuredWithUsage<T>(
  provider: LLMProvider,
  params: Parameters<LLMProvider["generateStructured"]>[0],
): Promise<StructuredGeneration<T>> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage<T>(params);
}
