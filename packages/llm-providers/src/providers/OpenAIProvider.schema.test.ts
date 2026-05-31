// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import { LLMResponseSchema } from "../schemas/LLMResponseSchema.js";
import type { LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.js";

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

const validParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: z.strictObject({ summary: z.string() }),
};

describe("OpenAIProvider schema conversion", () => {
  it("normalizes nested object schemas for OpenAI strict mode", async () => {
    const calls: unknown[] = [];
    const provider = newProvider(calls, {
      summary: "Reviewed",
      findings: [],
      walkthrough_markdown: "No findings.",
    });

    await provider.generateStructured({ ...validParams, schema: LLMResponseSchema });

    const request = requireRecord(firstCall(calls));
    const responseFormat = requireRecord(request["response_format"]);
    const jsonSchema = requireRecord(requireRecord(responseFormat["json_schema"])["schema"]);
    const properties = requireRecord(jsonSchema["properties"]);
    const findings = requireRecord(properties["findings"]);
    const findingItem = requireRecord(findings["items"]);
    const findingProperties = requireRecord(findingItem["properties"]);
    const cwe = requireRecord(findingProperties["cwe"]);
    expect(jsonSchema["additionalProperties"]).toBe(false);
    expect(jsonSchema["required"]).toEqual(["summary", "findings", "walkthrough_markdown"]);
    expect(findingItem["additionalProperties"]).toBe(false);
    expect(findingItem["required"]).toEqual([
      "severity",
      "category",
      "file",
      "line_start",
      "line_end",
      "title",
      "body",
      "cwe",
    ]);
    expect(cwe["type"]).toEqual(["string", "null"]);
  });

  it("fails unsupported schema conversion before sending a request", async () => {
    const calls: unknown[] = [];
    const provider = newProvider(calls, { summary: "Reviewed" });

    const error = await captureAsyncOpenAIProviderError(
      provider.generateStructured({
        ...validParams,
        schema: z.function({ input: [], output: z.string() }),
      }),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("response schema");
    expect(calls).toEqual([]);
  });

  it("rejects schemas whose JSON Schema root is not an object", async () => {
    const calls: unknown[] = [];
    const provider = newProvider(calls, "Reviewed");

    const error = await captureAsyncOpenAIProviderError(
      provider.generateStructured({ ...validParams, schema: z.string() }),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("object schema");
    expect(calls).toEqual([]);
  });

  it("rejects dynamic record schemas before sending a request", async () => {
    const calls: unknown[] = [];
    const provider = newProvider(calls, { metadata: {} });

    const error = await captureAsyncOpenAIProviderError(
      provider.generateStructured({
        ...validParams,
        schema: z.strictObject({ metadata: z.record(z.string(), z.string()) }),
      }),
    );

    expect(error.name).toBe("OpenAIProviderError");
    expect(error.message).toContain("dynamic object");
    expect(calls).toEqual([]);
  });
});

function newProvider(calls: unknown[], data: unknown): LLMProvider {
  const Provider = openAIProviderConstructor();

  return new Provider({
    apiKey: TestApiKey,
    client: fakeOpenAIClient(calls, data),
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

function fakeOpenAIClient(calls: unknown[], data: unknown): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request) => {
          calls.push(request);
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

async function captureAsyncOpenAIProviderError(
  promise: Promise<unknown>,
): Promise<OpenAIProviderError> {
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
