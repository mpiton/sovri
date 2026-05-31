// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { APIError } from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import * as LlmProviders from "../index.js";
import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const OpenAIApiKey = "test-openai-key";
const CompatibleApiKey = "test-openai-compatible-key";
const CompatibleBaseUrl = "https://scaleway-llm.eu.example/v1";
const TestModel = "gpt-5.5";
const ReviewedContent = '{"summary":"Reviewed"}';
const SharedTokenUsage = { prompt: 123, completion: 45 };
const RetriedTokenUsage = { prompt: 200, completion: 25 };

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

type ReviewData = z.infer<typeof ReviewParams.schema>;

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAIProviderConstructor {
  new (options: {
    readonly apiKey: string;
    readonly model?: string;
    readonly maxAttempts?: number;
    readonly client: FakeOpenAIChatClient;
  }): LLMProvider;
}

interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl: string;
  readonly maxAttempts?: number;
  readonly client: FakeOpenAIChatClient;
}

interface OpenAICompatibleProviderExports {
  readonly OpenAIProvider: OpenAIProviderConstructor;
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
}

const InvalidResponseContents = [
  '{"summary":42}',
  "{}",
  '{"summary":null}',
] satisfies ReadonlyArray<string>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("OpenAI-compatible protocol parity", () => {
  it("sends the same structured-output request shape as OpenAIProvider", async () => {
    const openAICalls: unknown[] = [];
    const compatibleCalls: unknown[] = [];
    const { OpenAIProvider, createOpenAICompatibleProvider } =
      await openAICompatibleProviderExports();

    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    // And an OpenAI-compatible provider is constructed with apiKey "test-openai-compatible-key", baseUrl "https://scaleway-llm.eu.example/v1", and an injected fake client
    // And the caller Zod schema requires {"summary": string}
    const openAIProvider = new OpenAIProvider({
      apiKey: OpenAIApiKey,
      model: TestModel,
      client: fakeOpenAIClient(openAIResponse(ReviewedContent), openAICalls),
    });
    const compatibleProvider = createOpenAICompatibleProvider({
      apiKey: CompatibleApiKey,
      model: TestModel,
      baseUrl: CompatibleBaseUrl,
      client: fakeOpenAIClient(openAIResponse(ReviewedContent), compatibleCalls),
    });

    // Given both fake clients return content "{\"summary\":\"Reviewed\"}"
    // And both fake clients report 123 prompt tokens and 45 completion tokens
    // When generateStructuredWithUsage is called on each provider with the same prompts
    const openAIResult = await generateStructuredWithUsage<ReviewData>(openAIProvider);
    const compatibleResult = await generateStructuredWithUsage<ReviewData>(compatibleProvider);

    // Then both clients receive exactly 1 chat completion request
    // And both requests contain the same model, messages, max_completion_tokens, response_format, and stream fields
    // And both requests use the JSON schema produced by zodToProviderJsonSchema
    expect(openAIResult).toEqual(compatibleResult);
    expect(openAICalls).toHaveLength(1);
    expect(compatibleCalls).toHaveLength(1);
    expect(firstCall(compatibleCalls)).toEqual(firstCall(openAICalls));
    expect(responseFormatSchema(firstCall(compatibleCalls))).toEqual(
      zodToProviderJsonSchema(ReviewParams.schema),
    );
  });

  it.each(InvalidResponseContents)(
    "keeps schema mismatch on the retryable typed error path for %s",
    async (responseContent) => {
      const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

      // Given the compatible fake client response content is "<response_content>"
      // And the compatible fake client reports 123 prompt tokens and 45 completion tokens
      const provider = createOpenAICompatibleProvider({
        apiKey: CompatibleApiKey,
        model: TestModel,
        baseUrl: CompatibleBaseUrl,
        client: fakeOpenAIClient(openAIResponse(responseContent), []),
      });

      // When generateStructuredWithUsage is called on the compatible provider
      const error = await captureOpenAIProviderError(generateStructuredWithUsage(provider));

      // Then OpenAIProviderError is thrown
      // And retryableWithCorrectivePrompt equals true
      // And the error exposes Zod issues
      expect(error).toBeInstanceOf(OpenAIProviderError);
      expect(error.retryableWithCorrectivePrompt).toBe(true);
      expect(error.issues?.length).toBeGreaterThan(0);
    },
  );

  it("uses the shared retry path for transient OpenAI-compatible failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const calls: unknown[] = [];
    const retryableError = APIError.generate(
      429,
      { error: { message: "Rate limited", code: "rate_limit" } },
      "Rate limited",
      new Headers({ "x-request-id": "req_compatible_retry" }),
    );
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();
    const provider = createOpenAICompatibleProvider({
      apiKey: CompatibleApiKey,
      model: TestModel,
      baseUrl: CompatibleBaseUrl,
      maxAttempts: 2,
      client: fakeOpenAIClientWithRetry(
        retryableError,
        openAIResponse('{"summary":"Retried"}', RetriedTokenUsage),
        calls,
      ),
    });

    // Given the compatible fake client first rejects with retryable HTTP status 429
    // And the compatible fake client then returns content "{\"summary\":\"Retried\"}"
    // And the second response reports 200 prompt tokens and 25 completion tokens
    // When generateStructuredWithUsage is called on the compatible provider
    const resultPromise = generateStructuredWithUsage<ReviewData>(provider);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    // Then data equals {"summary":"Retried"}
    // And tokenUsage equals {"prompt":200,"completion":25}
    // And exactly 2 compatible client calls are observed
    expect(result.data).toEqual({ summary: "Retried" });
    expect(result.tokenUsage).toEqual(RetriedTokenUsage);
    expect(calls).toHaveLength(2);
  });
});

async function openAICompatibleProviderExports(): Promise<OpenAICompatibleProviderExports> {
  const OpenAIProvider = Reflect.get(LlmProviders, "OpenAIProvider");
  const createOpenAICompatibleProvider = Reflect.get(
    LlmProviders,
    "createOpenAICompatibleProvider",
  );

  if (!isOpenAIProviderConstructor(OpenAIProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }
  if (typeof createOpenAICompatibleProvider !== "function") {
    throw new Error("createOpenAICompatibleProvider export is missing");
  }

  return { OpenAIProvider, createOpenAICompatibleProvider };
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function fakeOpenAIClient(response: unknown, calls: unknown[]): FakeOpenAIChatClient {
  return fakeOpenAIClientWithCreate(async (request) => {
    calls.push(request);
    return response;
  });
}

function fakeOpenAIClientWithRetry(
  firstError: Error,
  secondResponse: unknown,
  calls: unknown[],
): FakeOpenAIChatClient {
  let attempt = 0;

  return fakeOpenAIClientWithCreate(async (request) => {
    calls.push(request);
    attempt += 1;
    if (attempt === 1) {
      throw firstError;
    }

    return secondResponse;
  });
}

function fakeOpenAIClientWithCreate(
  create: (request: unknown, options?: unknown) => Promise<unknown>,
): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create,
      },
    },
  };
}

function openAIResponse(content: string, tokenUsage = SharedTokenUsage): unknown {
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: tokenUsage.prompt,
      completion_tokens: tokenUsage.completion,
    },
  };
}

function responseFormatSchema(request: unknown): unknown {
  const responseFormat = requireRecord(requireRecord(request)["response_format"]);
  const jsonSchema = requireRecord(responseFormat["json_schema"]);

  return jsonSchema["schema"];
}

function firstCall(calls: ReadonlyArray<unknown>): unknown {
  const [call] = calls;
  if (call === undefined) {
    throw new Error("Expected fake OpenAI-compatible client to capture a request");
  }

  return call;
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
