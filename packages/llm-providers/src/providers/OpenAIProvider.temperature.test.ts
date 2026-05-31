// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-key";
const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: z.strictObject({ summary: z.string() }),
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

describe("OpenAIProvider temperature validation", () => {
  it.each([-0.1, Number.NaN, 2.1])(
    "rejects invalid temperature value %s before requests",
    async (temperature) => {
      const requests: unknown[] = [];
      const provider = newProvider(requests);

      const error = await captureOpenAIProviderError(
        provider.generateStructured({ ...ReviewParams, temperature }),
      );

      expect(error.name).toBe("OpenAIProviderError");
      expect(error.message).toContain("temperature");
      expect(requests).toEqual([]);
    },
  );
});

function newProvider(requests: unknown[]): LLMProvider {
  const exportedProvider = Reflect.get(LlmProviders, "OpenAIProvider");
  if (!isOpenAIProviderConstructor(exportedProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }

  return new exportedProvider({
    apiKey: TestApiKey,
    client: fakeOpenAIClient(requests),
  });
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function fakeOpenAIClient(requests: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
            usage: { prompt_tokens: 123, completion_tokens: 45 },
          };
        },
      },
    },
  };
}

async function captureOpenAIProviderError(promise: Promise<unknown>): Promise<OpenAIProviderError> {
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
