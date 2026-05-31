// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import { z } from "@sovri/core";

import type { TokenUsage } from "../types/LLMProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";
import { createOpenAIStrictJsonSchema } from "./OpenAIProvider.schema-normalization.js";
import { stripOpenAIOptionalNulls } from "./OpenAIProvider.schema-stripping.js";

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
  const parsedSchema = schema.safeParse(stripOpenAIOptionalNulls(parsedJson, schema));

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
      schema: createOpenAIStrictJsonSchema(schema),
    },
  };
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
