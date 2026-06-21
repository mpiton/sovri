// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { z } from "@sovri/core";

import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import { stripOptionalNulls } from "../helpers/strip-optional-nulls.js";
import { normalizeStrictObjectShapes } from "../helpers/strict-json-schema.js";
import type { TokenUsage } from "../types/LLMProvider.js";
import { MistralProviderError } from "./MistralProvider.errors.js";
import type { MistralChatRequest } from "./MistralProvider.retry.js";

const MistralTokenUsageResponseSchema = z.object({
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }),
});

export function parseStructuredMistralResponse<T>(
  response: unknown,
  schema: z.ZodType<T>,
  tokenUsage: TokenUsage,
): T {
  const parsedJson = parseJson(extractMistralTextContent(response));
  const parsedSchema = schema.safeParse(stripOptionalNulls(parsedJson, schema));

  if (!parsedSchema.success) {
    throw new MistralProviderError("Mistral response failed schema validation", {
      cause: parsedSchema.error,
      issues: parsedSchema.error.issues,
      retryableWithCorrectivePrompt: true,
      tokenUsage,
    });
  }

  return parsedSchema.data;
}

export function extractMistralTokenUsage(response: unknown): TokenUsage {
  const parsed = MistralTokenUsageResponseSchema.safeParse(response);

  if (!parsed.success) {
    throw new MistralProviderError("Mistral response did not contain valid token usage", {
      cause: parsed.error,
      issues: parsed.error.issues,
    });
  }

  return {
    prompt: parsed.data.usage.promptTokens,
    completion: parsed.data.usage.completionTokens,
  };
}

export function createMistralJsonSchemaResponseFormat(
  schema: z.ZodType,
): MistralChatRequest["responseFormat"] {
  return {
    type: "json_schema",
    jsonSchema: {
      name: "sovri_structured_response",
      strict: true,
      schemaDefinition: createJsonSchemaDefinition(schema),
    },
  };
}

function createJsonSchemaDefinition(schema: z.ZodType): Record<string, unknown> {
  try {
    const jsonSchema = zodToProviderJsonSchema(schema);

    if (!isJsonObject(jsonSchema) || jsonSchema["type"] !== "object") {
      throw new MistralProviderError("Mistral JSON schema root must be an object schema");
    }

    // Strict mode at parity with OpenAI: force optional finding fields (notably
    // `cwe`) into `required` + nullable so the model must decide them per finding.
    return normalizeStrictObjectShapes(jsonSchema);
  } catch (cause) {
    if (cause instanceof MistralProviderError) throw cause;

    throw new MistralProviderError("Failed to build Mistral response schema", { cause });
  }
}

function extractMistralTextContent(response: unknown): string {
  const choices = isJsonObject(response) ? Reflect.get(response, "choices") : undefined;
  if (!Array.isArray(choices)) {
    throw new MistralProviderError("Mistral response did not contain choices");
  }

  const text = choices.map(textFromChoice).filter(isString).join("");
  if (text.trim().length === 0) {
    throw new MistralProviderError("Mistral response did not contain text content");
  }

  return text;
}

function textFromChoice(choice: unknown): string | undefined {
  const message = isJsonObject(choice) ? Reflect.get(choice, "message") : undefined;
  if (!isJsonObject(message)) return undefined;

  return textFromContent(Reflect.get(message, "content"));
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  return content.map(textFromChunk).filter(isString).join("");
}

function textFromChunk(chunk: unknown): string | undefined {
  if (!isJsonObject(chunk) || Reflect.get(chunk, "type") !== "text") return undefined;

  const text = Reflect.get(chunk, "text");
  return typeof text === "string" ? text : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new MistralProviderError("Mistral response was not valid JSON", { cause });
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
