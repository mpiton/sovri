// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { openAICompatibleProviderExports } from "../../test/providers/OpenAICompatibleProvider.exports-helper.js";
import type { FakeOpenAIChatClient } from "../../test/providers/OpenAICompatibleProvider.mock-helper.js";
import type { LLMProvider } from "../types/LLMProvider.js";

const TestApiKey = "test-openai-compatible-key";
const TestBaseUrl = "https://gateway.eu.example/v1";
const TestModel = "qwen2.5-coder-32b";
const ReviewTokenUsage = { prompt: 123, completion: 45 };

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

describe("OpenAI-compatible provider metadata", () => {
  it("sets a distinguishable provider name during construction", async () => {
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given apiKey is "test-openai-compatible-key"
    // And baseUrl is "https://gateway.eu.example/v1"
    // And model is "qwen2.5-coder-32b"
    // When the compatible provider is constructed with an injected fake client
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(),
    });

    // Then provider.name equals "openai-compatible"
    // And provider.name does not equal "openai"
    // And provider.model equals "qwen2.5-coder-32b"
    expect(provider.name).toBe("openai-compatible");
    expect(provider.name).not.toBe("openai");
    expect(provider.model).toBe(TestModel);
  });

  it("rejects OpenAI metadata for the compatible construction path", async () => {
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given the compatible construction path returns provider.name "openai-compatible"
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(),
    });

    // Then provider.name equals "openai-compatible"
    // And logs and audit events can distinguish "openai-compatible" from "openai"
    expect(
      provider.name,
      "logs and audit events must distinguish openai-compatible from openai",
    ).toBe("openai-compatible");
  });

  it("keeps the compatible provider name stable after structured generation", async () => {
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given the fake compatible client returns content "{\"summary\":\"Reviewed\"}"
    // And the fake compatible client reports 123 prompt tokens and 45 completion tokens
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(),
    });

    // When generateStructuredWithUsage is called
    const result = await requireGenerateStructuredWithUsage(provider);

    // Then provider.name still equals "openai-compatible"
    // And tokenUsage equals {"prompt":123,"completion":45}
    expect(provider.name).toBe("openai-compatible");
    expect(result.tokenUsage).toEqual(ReviewTokenUsage);
  });
});

function fakeOpenAIClient(): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
          usage: {
            prompt_tokens: ReviewTokenUsage.prompt,
            completion_tokens: ReviewTokenUsage.completion,
          },
        }),
      },
    },
  };
}

async function requireGenerateStructuredWithUsage(provider: LLMProvider) {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage(ReviewParams);
}
