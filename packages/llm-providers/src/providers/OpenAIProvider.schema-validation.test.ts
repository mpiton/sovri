// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import type { LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

const TestApiKey = "test-openai-key";
const CallerSchema = z.strictObject({
  summary: z.string(),
  findings: z.array(z.unknown()),
});
const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: CallerSchema,
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

describe("OpenAIProvider schema validation acceptance", () => {
  it("derives the OpenAI JSON schema response format from the supplied Zod schema", async () => {
    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    // And the caller Zod schema requires {"summary": string, "findings": array}
    // Given the fake OpenAI client records each chat completion request
    // And the fake OpenAI response content is "{\"summary\":\"Reviewed\",\"findings\":[]}"
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"summary":"Reviewed","findings":[]}'), calls);

    // When generateStructured is called
    const result = await provider.generateStructured(ReviewParams);

    // Then the OpenAI request contains response_format type "json_schema"
    // And response_format.json_schema.name equals "sovri_structured_response"
    // And response_format.json_schema.strict equals true
    // And response_format.json_schema.schema is derived through zodToProviderJsonSchema
    // And the returned data equals {"summary":"Reviewed","findings":[]}
    const request = requireRecord(firstCall(calls));
    const responseFormat = requireRecord(request["response_format"]);
    const jsonSchema = requireRecord(responseFormat["json_schema"]);
    expect(responseFormat["type"]).toBe("json_schema");
    expect(jsonSchema["name"]).toBe("sovri_structured_response");
    expect(jsonSchema["strict"]).toBe(true);
    expect(jsonSchema["schema"]).toEqual(zodToProviderJsonSchema(CallerSchema));
    expect(result).toEqual({ summary: "Reviewed", findings: [] });
  });

  it.each([
    '{"summary":123,"findings":[]}',
    '{"summary":"Reviewed"}',
    '{"summary":"Reviewed","findings":1}',
  ])("throws retryable typed errors for invalid response content %s", async (responseContent) => {
    // Given an OpenAIProvider is constructed with apiKey "test-openai-key" and an injected fake client
    // And the caller Zod schema requires {"summary": string, "findings": array}
    // Given the fake OpenAI response content is "<response_content>"
    // And the fake OpenAI response reports prompt token count 123
    // And the fake OpenAI response reports completion token count 45
    const provider = newProvider(openAIResponse(responseContent), []);

    // When generateStructuredWithUsage is called
    const error = await captureOpenAIProviderError(
      generateStructuredWithUsage(provider, ReviewParams),
    );

    // Then OpenAIProviderError is thrown
    // And retryableWithCorrectivePrompt equals true
    // And tokenUsage equals {"prompt":123,"completion":45}
    // And the error exposes Zod issues
    expect(error.name).toBe("OpenAIProviderError");
    expect(error.retryableWithCorrectivePrompt).toBe(true);
    expect(error.tokenUsage).toEqual({ prompt: 123, completion: 45 });
    expect(error.issues?.length).toBeGreaterThan(0);
  });

  it("fails unsupported schema conversion before any OpenAI SDK call", async () => {
    // Given the caller Zod schema contains z.function()
    // And the fake OpenAI client records each chat completion request
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"summary":"Reviewed"}'), calls);

    // When generateStructured is called
    const error = await captureOpenAIProviderError(
      provider.generateStructured({
        systemPrompt: "Review code safely.",
        userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
        schema: z.function({ input: [], output: z.string() }),
      }),
    );

    // Then OpenAIProviderError is thrown
    // And the error message contains "Failed to build OpenAI response schema"
    // And the fake OpenAI client receives 0 requests
    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("Failed to build OpenAI response schema");
    expect(calls).toEqual([]);
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

function firstCall(calls: ReadonlyArray<unknown>): unknown {
  const [call] = calls;
  if (call === undefined) {
    throw new Error("Expected fake OpenAI client to capture a request");
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

function generateStructuredWithUsage(
  provider: LLMProvider,
  params: Parameters<LLMProvider["generateStructured"]>[0],
): Promise<unknown> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage(params);
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
