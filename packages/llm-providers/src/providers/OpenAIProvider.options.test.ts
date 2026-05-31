// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
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

interface OpenAIProviderRuntimeOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly client?: FakeOpenAIChatClient;
}

interface OpenAIProviderConstructor {
  new (options: OpenAIProviderRuntimeOptions): LLMProvider;
}

interface CapturedOpenAIRequest {
  readonly request: unknown;
  readonly options: unknown;
}

describe("OpenAIProvider options and requests", () => {
  it("constructs without an injected client after validating the API key", () => {
    const Provider = openAIProviderConstructor();

    const provider = new Provider({ apiKey: ` ${TestApiKey} ` });

    expect(provider.name).toBe("openai");
    expect(provider.model).toBe("gpt-5.5");
    expect(provider.maxTokens).toBe(4096);
  });

  it("sends an OpenAI json_schema request with token, temperature, and retry settings", async () => {
    const Provider = openAIProviderConstructor();
    const captures: CapturedOpenAIRequest[] = [];
    const provider = new Provider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient({ summary: "Reviewed" }, captures),
      model: "  gpt-5.5-mini  ",
      maxTokens: 8192,
    });

    const result = await provider.generateStructured({
      systemPrompt: "Review code safely.",
      userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
      schema: z.strictObject({ summary: z.string() }),
      maxTokens: 128,
      temperature: 0.2,
    });

    const capture = firstCapture(captures);
    const request = requireRecord(capture.request);
    const completionOptions = requireRecord(capture.options);
    expect(result).toEqual({ summary: "Reviewed" });
    expect(provider.model).toBe("gpt-5.5-mini");
    expect(provider.maxTokens).toBe(8192);
    expect(request["model"]).toBe("gpt-5.5-mini");
    expect(request["max_completion_tokens"]).toBe(128);
    expect(request["temperature"]).toBe(0.2);
    expect(request["stream"]).toBe(false);
    expect(request["messages"]).toEqual([
      { role: "system", content: "Review code safely." },
      { role: "user", content: "diff --git a/src/auth.ts b/src/auth.ts" },
    ]);
    expect(requireRecord(request["response_format"])["type"]).toBe("json_schema");
    expect(completionOptions["maxRetries"]).toBe(0);
  });

  it("rejects blank API keys with a typed auth error", () => {
    const Provider = openAIProviderConstructor();

    const error = captureSyncOpenAIProviderError(() => new Provider({ apiKey: "   " }));

    expect(error).toBeInstanceOf(OpenAIProviderAuthError);
    expect(error.name).toBe("OpenAIProviderAuthError");
    expect(error.message).toContain("apiKey");
  });

  it("rejects blank model names before any SDK call", () => {
    const Provider = openAIProviderConstructor();

    const error = captureSyncOpenAIProviderError(
      () =>
        new Provider({
          apiKey: TestApiKey,
          client: fakeOpenAIClient({ summary: "Reviewed" }),
          model: "   ",
        }),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("model");
  });

  it.each([0, 1.5, 64_001])("rejects invalid maxTokens value %s", (maxTokens) => {
    const Provider = openAIProviderConstructor();

    const error = captureSyncOpenAIProviderError(
      () =>
        new Provider({
          apiKey: TestApiKey,
          client: fakeOpenAIClient({ summary: "Reviewed" }),
          maxTokens,
        }),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("maxTokens");
  });
});

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

function fakeOpenAIClient(
  data: unknown,
  captures: CapturedOpenAIRequest[] = [],
): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request, options) => {
          captures.push({ request, options });
          return {
            choices: [{ message: { content: JSON.stringify(data) } }],
            usage: {
              prompt_tokens: 123,
              completion_tokens: 45,
            },
          };
        },
      },
    },
  };
}

function firstCapture(captures: ReadonlyArray<CapturedOpenAIRequest>): CapturedOpenAIRequest {
  const [capture] = captures;
  if (capture === undefined) {
    throw new Error("Expected fake OpenAI client to capture a request");
  }

  return capture;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected value to be an object record");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureSyncOpenAIProviderError(action: () => unknown): OpenAIProviderError {
  try {
    action();
  } catch (error) {
    if (error instanceof OpenAIProviderError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected OpenAIProviderError");
}
