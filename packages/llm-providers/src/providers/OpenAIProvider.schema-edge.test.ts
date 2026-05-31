// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as LlmProviders from "../index.js";
import type { LLMProvider } from "../types/LLMProvider.js";

const TestApiKey = "test-openai-key";
const NestedReviewSchema = z.strictObject({
  summary: z.string(),
  groups: z.array(
    z.strictObject({
      title: z.string(),
      checks: z.array(
        z.strictObject({
          id: z.string(),
          cwe: z
            .string()
            .regex(/^CWE-\d{1,7}$/)
            .optional(),
        }),
      ),
    }),
  ),
});
const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "diff --git a/src/auth.ts b/src/auth.ts",
  schema: NestedReviewSchema,
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

describe("OpenAIProvider schema edge cases", () => {
  it("preserves optional fields in nested arrays through OpenAI strict schemas", async () => {
    const calls: unknown[] = [];
    const provider = newProvider(
      openAIResponse(
        '{"summary":"Reviewed","groups":[{"title":"Auth","checks":[{"id":"A1","cwe":null}]}]}',
      ),
      calls,
    );

    const result = await provider.generateStructured(ReviewParams);

    const cwe = nestedCweSchema(firstCall(calls));
    expect(cwe["type"]).toEqual(["string", "null"]);
    expect(result).toEqual({
      summary: "Reviewed",
      groups: [{ title: "Auth", checks: [{ id: "A1" }] }],
    });
  });

  it("strips optional null sentinels inside union branches before Zod validation", async () => {
    const schema = z.strictObject({
      item: z.union([
        z.strictObject({ kind: z.literal("first"), note: z.string().optional() }),
        z.strictObject({ kind: z.literal("second"), code: z.string() }),
      ]),
    });
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"item":{"kind":"first","note":null}}'), calls);

    const result = await provider.generateStructured({
      ...ReviewParams,
      schema,
    });

    expect(calls).toHaveLength(1);
    expect(JSON.stringify(openAIJsonSchema(firstCall(calls)))).not.toContain('"const"');
    expect(result).toEqual({ item: { kind: "first" } });
  });

  it("keeps nullable required union fields when stripping optional null sentinels", async () => {
    const schema = z.strictObject({
      item: z.union([
        z.strictObject({ kind: z.literal("first"), value: z.string().nullable() }),
        z.strictObject({ kind: z.literal("second"), note: z.string().optional() }),
      ]),
    });
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"item":{"kind":"first","value":null}}'), calls);

    const result = await provider.generateStructured({
      ...ReviewParams,
      schema,
    });

    expect(result).toEqual({ item: { kind: "first", value: null } });
  });

  it("preserves null values that are valid in optional nullable fields", async () => {
    const schema = z.strictObject({
      summary: z.string(),
      cwe: z.string().nullable().optional(),
    });
    const calls: unknown[] = [];
    const provider = newProvider(openAIResponse('{"summary":"Reviewed","cwe":null}'), calls);

    const result = await provider.generateStructured({
      ...ReviewParams,
      schema,
    });

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ summary: "Reviewed", cwe: null });
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

function nestedCweSchema(requestValue: unknown): Record<string, unknown> {
  const jsonSchema = openAIJsonSchema(requestValue);
  const properties = requireRecord(jsonSchema["properties"]);
  const groups = requireRecord(properties["groups"]);
  const groupItem = requireRecord(groups["items"]);
  const groupProperties = requireRecord(groupItem["properties"]);
  const checks = requireRecord(groupProperties["checks"]);
  const checkItem = requireRecord(checks["items"]);
  const checkProperties = requireRecord(checkItem["properties"]);
  expect(checkItem["required"]).toEqual(["id", "cwe"]);

  return requireRecord(checkProperties["cwe"]);
}

function openAIJsonSchema(requestValue: unknown): Record<string, unknown> {
  const request = requireRecord(requestValue);
  const responseFormat = requireRecord(request["response_format"]);
  return requireRecord(requireRecord(responseFormat["json_schema"])["schema"]);
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
