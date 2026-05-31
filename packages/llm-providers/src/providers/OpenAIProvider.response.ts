// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { z } from "@sovri/core";

import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import type { TokenUsage } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";

type OpenAIChatRequest = ChatCompletionCreateParamsNonStreaming;

const OpenAITokenUsageResponseSchema = z.object({
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  }),
});

const OpenAITextResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
});

export function parseStructuredOpenAIResponse<T>(
  response: unknown,
  schema: z.ZodType<T>,
  tokenUsage: TokenUsage,
): T {
  const parsedJson = parseJson(extractOpenAITextContent(response));
  const parsedSchema = schema.safeParse(parsedJson);

  if (!parsedSchema.success) {
    throw new OpenAIProviderError("OpenAI response failed schema validation", {
      cause: parsedSchema.error,
      issues: parsedSchema.error.issues,
      retryableWithCorrectivePrompt: true,
      tokenUsage,
    });
  }

  return parsedSchema.data;
}

export function extractOpenAITokenUsage(response: unknown): TokenUsage {
  const parsed = OpenAITokenUsageResponseSchema.safeParse(response);

  if (!parsed.success) {
    throw new OpenAIProviderError("OpenAI response did not contain valid token usage", {
      cause: parsed.error,
      issues: parsed.error.issues,
    });
  }

  return {
    prompt: parsed.data.usage.prompt_tokens,
    completion: parsed.data.usage.completion_tokens,
  };
}

export function createOpenAIJsonSchemaResponseFormat(
  schema: z.ZodType,
): NonNullable<OpenAIChatRequest["response_format"]> {
  return {
    type: "json_schema",
    json_schema: {
      name: "sovri_structured_response",
      strict: true,
      schema: createJsonSchemaDefinition(schema),
    },
  };
}

function createJsonSchemaDefinition(schema: z.ZodType): Record<string, unknown> {
  try {
    const jsonSchema = zodToProviderJsonSchema(schema);

    if (!isJsonObject(jsonSchema) || jsonSchema["type"] !== "object") {
      throw new OpenAIProviderError("OpenAI JSON schema root must be an object schema");
    }

    return jsonSchema;
  } catch (cause) {
    if (cause instanceof OpenAIProviderError) throw cause;

    throw new OpenAIProviderError("Failed to build OpenAI response schema", { cause });
  }
}

function extractOpenAITextContent(response: unknown): string {
  const parsed = OpenAITextResponseSchema.safeParse(response);

  if (!parsed.success) {
    throw new OpenAIProviderError("OpenAI response did not contain choices", {
      cause: parsed.error,
      issues: parsed.error.issues,
    });
  }

  const text = parsed.data.choices.map((choice) => choice.message.content).join("");
  if (text.trim().length === 0) {
    throw new OpenAIProviderError("OpenAI response did not contain text content");
  }

  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new OpenAIProviderError("OpenAI response was not valid JSON", { cause });
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
