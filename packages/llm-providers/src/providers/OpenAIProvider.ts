// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import OpenAI from "openai";

import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "../types/LLMProvider.js";
import {
  createOpenAIClientOptions,
  resolveMaxTokens,
  resolveOpenAIProviderOptions,
  type OpenAIProviderConfigOptions,
} from "./OpenAIProvider.options.js";
import {
  createOpenAIJsonSchemaResponseFormat,
  extractOpenAITokenUsage,
  parseStructuredOpenAIResponse,
} from "./OpenAIProvider.response.js";
import {
  createOpenAIChatCompletionWithRetry,
  type OpenAIChatClient,
  type OpenAIChatRequest,
} from "./OpenAIProvider.retry.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";

export {
  OpenAIProviderAuthError,
  OpenAIProviderError,
  OpenAIProviderRetryError,
  OpenAIProviderTimeoutError,
  type OpenAIProviderErrorOptions,
} from "./OpenAIProvider.errors.js";
export {
  DEFAULT_OPENAI_MAX_ATTEMPTS,
  DEFAULT_OPENAI_MAX_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  MAX_OPENAI_MAX_ATTEMPTS,
  MAX_OPENAI_MAX_TOKENS,
  MAX_OPENAI_TIMEOUT_MS,
} from "./OpenAIProvider.options.js";
export type { OpenAIChatClient } from "./OpenAIProvider.retry.js";

export interface OpenAIProviderOptions extends OpenAIProviderConfigOptions {
  readonly client?: OpenAIChatClient;
}

// OpenAI temperature spans 0 (more deterministic) through 2 (more exploratory).
const MIN_OPENAI_TEMPERATURE = 0;
const MAX_OPENAI_TEMPERATURE = 2;

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;

  private readonly client: OpenAIChatClient;

  constructor(options: OpenAIProviderOptions) {
    const resolvedOptions = resolveOpenAIProviderOptions(options);

    this.model = resolvedOptions.model;
    this.maxTokens = resolvedOptions.maxTokens;
    this.timeoutMs = resolvedOptions.timeoutMs;
    this.maxAttempts = resolvedOptions.maxAttempts;
    this.client =
      options.client ??
      new OpenAI(
        createOpenAIClientOptions(
          resolvedOptions.apiKey,
          resolvedOptions.timeoutMs,
          resolvedOptions.baseUrl,
        ),
      );
  }

  /**
   * Generates structured data from OpenAI and returns only the schema-validated payload.
   */
  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const result = await this.generateStructuredWithUsage(params);

    return result.data;
  }

  /**
   * Generates structured data from OpenAI with schema validation and token usage metadata.
   */
  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    const response = await this.createChatCompletion(params);
    const tokenUsage = extractOpenAITokenUsage(response);
    const data = parseStructuredOpenAIResponse(response, params.schema, tokenUsage);

    return { data, tokenUsage };
  }

  private async createChatCompletion<T>(params: GenerateStructuredParams<T>): Promise<unknown> {
    return createOpenAIChatCompletionWithRetry({
      client: this.client,
      request: this.createRequest(params),
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts,
    });
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
      request.temperature = resolveTemperature(params.temperature);
    }

    return request;
  }
}

function resolveTemperature(temperature: number): number {
  if (
    !Number.isFinite(temperature) ||
    temperature < MIN_OPENAI_TEMPERATURE ||
    temperature > MAX_OPENAI_TEMPERATURE
  ) {
    throw new OpenAIProviderError(
      `OpenAI temperature must be between ${String(MIN_OPENAI_TEMPERATURE)} and ${String(MAX_OPENAI_TEMPERATURE)}`,
    );
  }

  return temperature;
}
