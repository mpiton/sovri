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

    return normalizeOpenAIStrictJsonSchema(jsonSchema);
  } catch (cause) {
    if (cause instanceof OpenAIProviderError) throw cause;

    throw new OpenAIProviderError("Failed to build OpenAI response schema", { cause });
  }
}

function normalizeOpenAIStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeJsonSchemaValue(schema);
  if (!isJsonObject(normalized)) {
    throw new OpenAIProviderError("OpenAI JSON schema root must be an object schema");
  }

  return normalized;
}

function normalizeJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaValue);
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const normalized = normalizeJsonSchemaObject(value);
  normalizeOpenAIObjectShape(normalized);

  return normalized;
}

function normalizeJsonSchemaObject(value: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeJsonSchemaValue(child);
  }

  return normalized;
}

function normalizeOpenAIObjectShape(schema: Record<string, unknown>): void {
  const properties = schema["properties"];
  if (schema["type"] !== "object" && !isJsonObject(properties)) {
    return;
  }
  if (hasDynamicObjectProperties(schema)) {
    throw new OpenAIProviderError(
      "OpenAI strict JSON schemas do not support dynamic object properties",
    );
  }

  schema["additionalProperties"] = false;
  schema["required"] = isJsonObject(properties) ? Object.keys(properties) : [];
}

function hasDynamicObjectProperties(schema: Record<string, unknown>): boolean {
  const additionalProperties = schema["additionalProperties"];
  return (
    schema["propertyNames"] !== undefined ||
    (additionalProperties !== undefined && additionalProperties !== false)
  );
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
