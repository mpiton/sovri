// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type {
  JSONOutputFormat,
  MessageCreateParamsNonStreaming,
  Model,
} from "@anthropic-ai/sdk/resources/messages/messages";

import { z } from "@sovri/core";

import { AnthropicAuthError, AnthropicResponseError } from "../errors.js";
import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
  TokenUsage,
} from "../types/LLMProvider.js";
import {
  createAnthropicMessageWithRetry,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  type AnthropicMessagesClient,
} from "./AnthropicProvider.retry.js";

export const DEFAULT_ANTHROPIC_MODEL: Model = "claude-sonnet-4-6";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
export const MAX_ANTHROPIC_MAX_TOKENS = 64_000;
// Node's setTimeout caps delays at 2^31 - 1 ms (~24.8 days). Values above this
// clamp to 1 ms and would fire the abort almost immediately.
export const MAX_ANTHROPIC_TIMEOUT_MS = 2_147_483_647;
export { DEFAULT_ANTHROPIC_TIMEOUT_MS } from "./AnthropicProvider.retry.js";

type AnthropicJsonSchema = Parameters<typeof jsonSchemaOutputFormat>[0];

const AnthropicTokenUsageResponseSchema = z.object({
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative().default(0),
    cache_read_input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export interface AnthropicProviderOptions {
  readonly model?: Model;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly client?: AnthropicMessagesClient;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: Model;
  readonly maxTokens: number;
  readonly timeoutMs: number;

  private readonly client: AnthropicMessagesClient;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = resolveModel(options.model);
    this.maxTokens = resolveMaxTokens(options.maxTokens);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.client =
      options.client ??
      new Anthropic({
        apiKey: readAnthropicApiKey(options.env ?? process.env),
        baseURL: resolveBaseUrl(options.baseUrl),
        maxRetries: 0,
        timeout: this.timeoutMs,
      });
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const result = await this.generateStructuredWithUsage(params);

    return result.data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    const request = this.createRequest(params);
    const response = await this.createMessage(request);
    const tokenUsage = extractTokenUsage(response);
    const data = parseStructuredResponse(response, params.schema, tokenUsage);

    return { data, tokenUsage };
  }

  private createRequest<T>(params: GenerateStructuredParams<T>): MessageCreateParamsNonStreaming {
    const request: MessageCreateParamsNonStreaming = {
      max_tokens: resolveMaxTokens(params.maxTokens ?? this.maxTokens),
      messages: [{ role: "user", content: params.userPrompt }],
      model: this.model,
      output_config: { format: createJsonSchemaFormat(params.schema) },
      stream: false,
      system: params.systemPrompt,
    };

    if (params.temperature !== undefined) {
      request.temperature = params.temperature;
    }

    return request;
  }

  private async createMessage(request: MessageCreateParamsNonStreaming): Promise<unknown> {
    return createAnthropicMessageWithRetry({
      client: this.client,
      request,
      timeoutMs: this.timeoutMs,
    });
  }
}

function parseStructuredResponse<T>(
  response: unknown,
  schema: z.ZodType<T>,
  tokenUsage: TokenUsage,
): T {
  const text = extractTextContent(response);
  const parsedJson = parseJson(text);
  const parsedSchema = schema.safeParse(parsedJson);

  if (!parsedSchema.success) {
    throw new AnthropicResponseError("Anthropic response failed schema validation", {
      cause: parsedSchema.error,
      issues: parsedSchema.error.issues,
      retryableWithCorrectivePrompt: true,
      tokenUsage,
    });
  }

  return parsedSchema.data;
}

function extractTokenUsage(response: unknown): TokenUsage {
  const parsed = AnthropicTokenUsageResponseSchema.safeParse(response);

  if (!parsed.success) {
    throw new AnthropicResponseError("Anthropic response did not contain valid token usage", {
      cause: parsed.error,
      issues: parsed.error.issues,
    });
  }

  return {
    prompt:
      parsed.data.usage.input_tokens +
      parsed.data.usage.cache_creation_input_tokens +
      parsed.data.usage.cache_read_input_tokens,
    completion: parsed.data.usage.output_tokens,
  };
}

function readAnthropicApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    throw new AnthropicAuthError("ANTHROPIC_API_KEY must be set to a non-empty value");
  }

  return apiKey;
}

function resolveModel(model: Model | undefined): Model {
  const resolvedModel = model ?? DEFAULT_ANTHROPIC_MODEL;

  if (resolvedModel.trim().length === 0) {
    throw new AnthropicResponseError("Anthropic model must be a non-empty value");
  }

  return resolvedModel;
}

function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;

  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new AnthropicResponseError("Anthropic baseUrl must be a non-empty value");
  }

  return trimmed;
}

function resolveMaxTokens(maxTokens: number | undefined): number {
  const resolvedMaxTokens = maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;

  if (
    !Number.isSafeInteger(resolvedMaxTokens) ||
    resolvedMaxTokens <= 0 ||
    resolvedMaxTokens > MAX_ANTHROPIC_MAX_TOKENS
  ) {
    throw new AnthropicResponseError(
      `Anthropic maxTokens must be a positive integer no greater than ${String(MAX_ANTHROPIC_MAX_TOKENS)}`,
    );
  }

  return resolvedMaxTokens;
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolvedTimeoutMs = timeoutMs ?? DEFAULT_ANTHROPIC_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(resolvedTimeoutMs) ||
    resolvedTimeoutMs <= 0 ||
    resolvedTimeoutMs > MAX_ANTHROPIC_TIMEOUT_MS
  ) {
    throw new AnthropicResponseError(
      `Anthropic timeoutMs must be a positive integer no greater than ${String(MAX_ANTHROPIC_TIMEOUT_MS)}`,
    );
  }

  return resolvedTimeoutMs;
}

function createJsonSchemaFormat(schema: z.ZodType): JSONOutputFormat {
  let jsonSchema: unknown;

  try {
    jsonSchema = zodToProviderJsonSchema(schema);
  } catch (cause) {
    throw new AnthropicResponseError("Failed to build Anthropic JSON schema", { cause });
  }

  if (!isAnthropicRootJsonSchema(jsonSchema)) {
    throw new AnthropicResponseError("Anthropic JSON schema root must be an object schema");
  }

  return jsonSchemaOutputFormat(jsonSchema);
}

function extractTextContent(response: unknown): string {
  if (!isJsonObject(response) || !Array.isArray(response.content)) {
    throw new AnthropicResponseError("Anthropic response did not contain a content array");
  }

  const text = response.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");

  if (text.trim().length === 0) {
    throw new AnthropicResponseError("Anthropic response did not contain text content");
  }

  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new AnthropicResponseError("Anthropic response was not valid JSON", { cause });
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextBlock(value: unknown): value is { readonly text: string } {
  return isJsonObject(value) && value.type === "text" && typeof value.text === "string";
}

function isAnthropicRootJsonSchema(value: unknown): value is AnthropicJsonSchema {
  return isJsonObject(value) && value.type === "object";
}
