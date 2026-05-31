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
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAIProviderRuntimeOptions {
  readonly apiKey: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly client: FakeOpenAIChatClient;
}

interface OpenAIProviderConstructor {
  new (options: OpenAIProviderRuntimeOptions): LLMProvider & {
    readonly timeoutMs?: unknown;
    readonly maxAttempts?: unknown;
  };
}

type NumericOptionName = "maxTokens" | "timeoutMs" | "maxAttempts";

const InvalidNumericOptions = [
  ["maxTokens", 0, "maxTokens must be a positive integer no greater than"],
  ["maxTokens", 64_001, "maxTokens must be a positive integer no greater than"],
  ["timeoutMs", 0, "timeoutMs must be a positive integer no greater than"],
  ["timeoutMs", 2_147_483_648, "timeoutMs must be a positive integer no greater than"],
  ["maxAttempts", 0, "maxAttempts must be a positive integer"],
  ["maxAttempts", 1.5, "maxAttempts must be a positive integer"],
  ["maxAttempts", 11, "maxAttempts must be a positive integer"],
] satisfies ReadonlyArray<readonly [NumericOptionName, number, string]>;

describe("OpenAIProvider numeric option bounds acceptance", () => {
  it("uses the documented default numeric provider bounds", () => {
    // Given apiKey is "test-openai-key"
    // And the fake OpenAI client records each chat completion request
    // And DEFAULT_OPENAI_MAX_TOKENS equals 4096
    // And MAX_OPENAI_MAX_TOKENS equals 64000
    // And DEFAULT_OPENAI_TIMEOUT_MS equals 60000
    // And MAX_OPENAI_TIMEOUT_MS equals 2147483647
    // And DEFAULT_OPENAI_MAX_ATTEMPTS equals 3
    const module = openAIProviderExports();
    const requests: unknown[] = [];
    // When an OpenAIProvider is constructed with the injected fake client
    const provider = new module.OpenAIProvider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient(requests),
    });
    // Then maxTokens equals 4096
    // And timeoutMs equals 60000
    // And maxAttempts equals 3
    expect(module.DEFAULT_OPENAI_MAX_TOKENS).toBe(4096);
    expect(module.MAX_OPENAI_MAX_TOKENS).toBe(64_000);
    expect(module.DEFAULT_OPENAI_TIMEOUT_MS).toBe(60_000);
    expect(module.MAX_OPENAI_TIMEOUT_MS).toBe(2_147_483_647);
    expect(module.DEFAULT_OPENAI_MAX_ATTEMPTS).toBe(3);
    expect(module.MAX_OPENAI_MAX_ATTEMPTS).toBe(10);
    expect(provider.maxTokens).toBe(4096);
    expect(provider.timeoutMs).toBe(60_000);
    expect(provider.maxAttempts).toBe(3);
  });

  it.each(InvalidNumericOptions)(
    "rejects invalid %s value %s before requests",
    async (optionName, optionValue, messageFragment) => {
      const { OpenAIProvider } = openAIProviderExports();
      const requests: unknown[] = [];
      // Given OpenAIProvider option "<option_name>" is <option_value>
      // When an OpenAIProvider is constructed with the injected fake client
      const error = await captureOpenAIProviderError(
        () => new OpenAIProvider(providerOptions(optionName, optionValue, requests)),
      );
      // Then OpenAIProviderError is thrown
      // And the error message contains "<message_fragment>"
      // And the fake OpenAI client receives 0 requests
      expect(error.message).toContain(messageFragment);
      expect(requests).toEqual([]);
    },
  );

  it("validates per-call maxTokens with the constructor maxTokens bounds", async () => {
    const { OpenAIProvider } = openAIProviderExports();
    const requests: unknown[] = [];
    // Given an OpenAIProvider is constructed with maxTokens 4096 and the injected fake client
    // And the fake OpenAI response content is "{\"summary\":\"Reviewed\"}"
    const provider = new OpenAIProvider({
      apiKey: TestApiKey,
      maxTokens: 4096,
      client: fakeOpenAIClient(requests),
    });
    // When generateStructured is called with maxTokens 64000
    await provider.generateStructured({ ...ReviewParams, maxTokens: 64_000 });
    // Then the OpenAI request max_completion_tokens equals 64000
    expect(firstRequestField(requests, "max_completion_tokens")).toBe(64_000);
    // When generateStructured is called with maxTokens 64001
    const error = await captureOpenAIProviderError(() =>
      provider.generateStructured({ ...ReviewParams, maxTokens: 64_001 }),
    );
    // Then OpenAIProviderError is thrown
    // And the fake OpenAI client does not receive a request for the invalid call
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(requests).toHaveLength(1);
  });
});

function openAIProviderExports() {
  const OpenAIProvider = Reflect.get(LlmProviders, "OpenAIProvider");
  if (!isOpenAIProviderConstructor(OpenAIProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }

  return {
    OpenAIProvider,
    DEFAULT_OPENAI_MAX_TOKENS: Reflect.get(LlmProviders, "DEFAULT_OPENAI_MAX_TOKENS"),
    MAX_OPENAI_MAX_TOKENS: Reflect.get(LlmProviders, "MAX_OPENAI_MAX_TOKENS"),
    DEFAULT_OPENAI_TIMEOUT_MS: Reflect.get(LlmProviders, "DEFAULT_OPENAI_TIMEOUT_MS"),
    MAX_OPENAI_TIMEOUT_MS: Reflect.get(LlmProviders, "MAX_OPENAI_TIMEOUT_MS"),
    DEFAULT_OPENAI_MAX_ATTEMPTS: Reflect.get(LlmProviders, "DEFAULT_OPENAI_MAX_ATTEMPTS"),
    MAX_OPENAI_MAX_ATTEMPTS: Reflect.get(LlmProviders, "MAX_OPENAI_MAX_ATTEMPTS"),
  };
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function providerOptions(
  optionName: NumericOptionName,
  optionValue: number,
  requests: unknown[],
): OpenAIProviderRuntimeOptions {
  const common = { apiKey: TestApiKey, client: fakeOpenAIClient(requests) };
  if (optionName === "maxTokens") return { ...common, maxTokens: optionValue };
  if (optionName === "timeoutMs") return { ...common, timeoutMs: optionValue };

  return { ...common, maxAttempts: optionValue };
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

async function captureOpenAIProviderError(
  action: () => unknown | Promise<unknown>,
): Promise<OpenAIProviderError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof OpenAIProviderError) return error;
    throw error;
  }
  throw new Error("Expected OpenAIProviderError");
}

function firstRequestField(requests: ReadonlyArray<unknown>, field: string): unknown {
  const [request] = requests;
  if (!isRecord(request)) throw new Error("Expected first request to be an object record");

  return request[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
