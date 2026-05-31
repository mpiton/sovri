// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider } from "../types/LLMProvider.js";

const TestApiKey = "test-openai-key";
const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: z.strictObject({ item: z.unknown() }),
};

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

describe("OpenAIProvider schema branch selection", () => {
  it("respects additionalProperties false when stripping union branch nulls", async () => {
    const schema = z.strictObject({
      item: z.union([
        z.strictObject({ a: z.string().optional() }),
        z.strictObject({ b: z.string().nullable() }),
      ]),
    });
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"item":{"b":null}}'), calls);

    const result = await provider.generateStructured({
      ...ReviewParams,
      schema,
    });

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ item: { b: null } });
  });
});

function newProvider(response: unknown, calls: unknown[]): LLMProvider {
  const exportedProvider = Reflect.get(LlmProviders, "OpenAIProvider");
  if (!isOpenAIProviderConstructor(exportedProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }

  return new exportedProvider({
    apiKey: TestApiKey,
    client: fakeOpenAIClient(response, calls),
  });
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function fakeOpenAIClient(response: unknown, calls: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request) => {
          calls.push(request);
          return response;
        },
      },
    },
  };
}

function openAIResponse(content: string): unknown {
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 123,
      completion_tokens: 45,
    },
  };
}
