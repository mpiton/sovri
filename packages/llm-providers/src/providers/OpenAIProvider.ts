// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import OpenAI, { type ClientOptions } from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  Completions,
} from "openai/resources/chat/completions";

import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "../types/LLMProvider.js";
import { OpenAIProviderAuthError, OpenAIProviderError } from "./OpenAIProvider.errors.js";
import {
  createOpenAIJsonSchemaResponseFormat,
  extractOpenAITokenUsage,
  parseStructuredOpenAIResponse,
} from "./OpenAIProvider.response.js";

export {
  OpenAIProviderAuthError,
  OpenAIProviderError,
  type OpenAIProviderErrorOptions,
} from "./OpenAIProvider.errors.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_OPENAI_MAX_TOKENS = 4096;
export const MAX_OPENAI_MAX_TOKENS = 64_000;

export type OpenAIChatComplete = Completions["create"];
export type OpenAIChatRequest = ChatCompletionCreateParamsNonStreaming;

export interface OpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: OpenAIChatComplete;
    };
  };
}

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly client?: OpenAIChatClient;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  readonly maxTokens: number;

  private readonly client: OpenAIChatClient;

  constructor(options: OpenAIProviderOptions) {
    const apiKey = resolveApiKey(options.apiKey);

    this.model = resolveModel(options.model);
    this.maxTokens = resolveMaxTokens(options.maxTokens);
    this.client = options.client ?? new OpenAI(createOpenAIClientOptions(apiKey));
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const result = await this.generateStructuredWithUsage(params);

    return result.data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    const response = await this.client.chat.completions.create(this.createRequest(params), {
      maxRetries: 0,
    });
    const tokenUsage = extractOpenAITokenUsage(response);
    const data = parseStructuredOpenAIResponse(response, params.schema, tokenUsage);

    return { data, tokenUsage };
  }

  private createRequest<T>(params: GenerateStructuredParams<T>): OpenAIChatRequest {
    const request: OpenAIChatRequest = {
      model: this.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      max_completion_tokens: resolveMaxTokens(params.maxTokens ?? this.maxTokens),
      response_format: createOpenAIJsonSchemaResponseFormat(params.schema),
      stream: false,
    };

    if (params.temperature !== undefined) {
      request.temperature = params.temperature;
    }

    return request;
  }
}

function createOpenAIClientOptions(apiKey: string): ClientOptions {
  return {
    apiKey,
    maxRetries: 0,
  };
}

function resolveApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new OpenAIProviderAuthError("OpenAI apiKey must be a non-empty value");
  }

  return trimmed;
}

function resolveModel(model: string | undefined): string {
  const trimmed = (model ?? DEFAULT_OPENAI_MODEL).trim();
  if (trimmed.length === 0) {
    throw new OpenAIProviderError("OpenAI model must be a non-empty value");
  }

  return trimmed;
}

function resolveMaxTokens(maxTokens: number | undefined): number {
  const resolvedMaxTokens = maxTokens ?? DEFAULT_OPENAI_MAX_TOKENS;

  if (
    !Number.isSafeInteger(resolvedMaxTokens) ||
    resolvedMaxTokens <= 0 ||
    resolvedMaxTokens > MAX_OPENAI_MAX_TOKENS
  ) {
    throw new OpenAIProviderError(
      `OpenAI maxTokens must be a positive integer no greater than ${String(MAX_OPENAI_MAX_TOKENS)}`,
    );
  }

  return resolvedMaxTokens;
}
