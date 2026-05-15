// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import Anthropic, { APIError, AuthenticationError } from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type {
  JSONOutputFormat,
  MessageCreateParamsNonStreaming,
  Model,
} from "@anthropic-ai/sdk/resources/messages/messages";

import type { z } from "@sovri/core";

import { AnthropicAuthError, AnthropicResponseError } from "../errors.js";
import { zodToProviderJsonSchema } from "../helpers/provider-json-schema.js";
import type { GenerateStructuredParams, LLMProvider } from "../types/LLMProvider.js";

export const DEFAULT_ANTHROPIC_MODEL: Model = "claude-sonnet-4-6";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
export const MAX_ANTHROPIC_MAX_TOKENS = 64_000;

const STRUCTURED_OUTPUTS_BETA_HEADER = "structured-outputs-2025-11-13";

type AnthropicMessagesClient = Pick<Anthropic, "messages">;
type AnthropicJsonSchema = Parameters<typeof jsonSchemaOutputFormat>[0];

export interface AnthropicProviderOptions {
  readonly model?: Model;
  readonly maxTokens?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly client?: AnthropicMessagesClient;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: Model;
  readonly maxTokens: number;

  private readonly client: AnthropicMessagesClient;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = resolveModel(options.model);
    this.maxTokens = resolveMaxTokens(options.maxTokens);
    this.client =
      options.client ?? new Anthropic({ apiKey: readAnthropicApiKey(options.env ?? process.env) });
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const request = this.createRequest(params);
    const response = await this.createMessage(request);
    const text = extractTextContent(response);
    const parsedJson = parseJson(text);
    const parsedSchema = params.schema.safeParse(parsedJson);

    if (!parsedSchema.success) {
      throw new AnthropicResponseError("Anthropic response failed schema validation", {
        cause: parsedSchema.error,
        issues: parsedSchema.error.issues,
      });
    }

    return parsedSchema.data;
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
    try {
      return await this.client.messages.create(request, {
        headers: { "anthropic-beta": STRUCTURED_OUTPUTS_BETA_HEADER },
      });
    } catch (cause) {
      throw normalizeAnthropicError(cause);
    }
  }
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

function normalizeAnthropicError(cause: unknown): Error {
  if (cause instanceof AuthenticationError || (cause instanceof APIError && cause.status === 401)) {
    return new AnthropicAuthError("Anthropic authentication failed", anthropicErrorOptions(cause));
  }

  return new AnthropicResponseError("Anthropic API request failed", anthropicErrorOptions(cause));
}

function anthropicErrorOptions(cause: unknown) {
  if (!(cause instanceof APIError)) return { cause };

  return {
    cause,
    ...(cause.status !== undefined ? { status: cause.status } : {}),
    ...(cause.requestID !== undefined ? { requestId: cause.requestID } : {}),
  };
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
