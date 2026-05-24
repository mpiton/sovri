// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { Mistral, type SDKOptions } from "@mistralai/mistralai";

import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "../types/LLMProvider.js";
import { MistralProviderError } from "./MistralProvider.errors.js";
import {
  createMistralJsonSchemaResponseFormat,
  extractMistralTokenUsage,
  parseStructuredMistralResponse,
} from "./MistralProvider.response.js";
import {
  createMistralChatCompletionWithRetry,
  DEFAULT_MISTRAL_MAX_ATTEMPTS,
  DEFAULT_MISTRAL_TIMEOUT_MS,
  type MistralChatClient,
  type MistralChatRequest,
} from "./MistralProvider.retry.js";

export {
  MistralProviderError,
  MistralProviderRetryError,
  MistralProviderTimeoutError,
  type MistralProviderErrorOptions,
} from "./MistralProvider.errors.js";

export const DEFAULT_MISTRAL_MODEL = "mistral-large-latest";
export const DEFAULT_MISTRAL_MAX_TOKENS = 4096;
export const MAX_MISTRAL_MAX_TOKENS = 64_000;
export const MAX_MISTRAL_TIMEOUT_MS = 2_147_483_647;
export { DEFAULT_MISTRAL_TIMEOUT_MS } from "./MistralProvider.retry.js";

export interface MistralProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly client?: MistralChatClient;
}

export class MistralProvider implements LLMProvider {
  readonly name = "mistral";
  readonly model: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;

  private readonly client: MistralChatClient;

  constructor(options: MistralProviderOptions) {
    const apiKey = resolveApiKey(options.apiKey);
    const baseUrl = resolveBaseUrl(options.baseUrl);

    this.model = resolveModel(options.model);
    this.maxTokens = resolveMaxTokens(options.maxTokens);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.maxAttempts = resolveMaxAttempts(options.maxAttempts);
    this.client =
      options.client ?? new Mistral(createMistralSdkOptions(apiKey, baseUrl, this.timeoutMs));
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    const result = await this.generateStructuredWithUsage(params);

    return result.data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    const response = await createMistralChatCompletionWithRetry({
      client: this.client,
      request: this.createRequest(params),
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts,
    });
    const tokenUsage = extractMistralTokenUsage(response);
    const data = parseStructuredMistralResponse(response, params.schema, tokenUsage);

    return { data, tokenUsage };
  }

  private createRequest<T>(params: GenerateStructuredParams<T>): MistralChatRequest {
    const request: MistralChatRequest = {
      model: this.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      maxTokens: resolveMaxTokens(params.maxTokens ?? this.maxTokens),
      responseFormat: createMistralJsonSchemaResponseFormat(params.schema),
    };

    if (params.temperature !== undefined) {
      request.temperature = params.temperature;
    }

    return request;
  }
}

function createMistralSdkOptions(
  apiKey: string,
  baseUrl: string | undefined,
  timeoutMs: number,
): SDKOptions {
  const sdkOptions: SDKOptions = {
    apiKey,
    timeoutMs,
    retryConfig: { strategy: "none" },
  };

  if (baseUrl !== undefined) {
    sdkOptions.serverURL = baseUrl;
  }

  return sdkOptions;
}

function resolveApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    throw new MistralProviderError("Mistral apiKey must be a non-empty value");
  }

  return trimmed;
}

function resolveModel(model: string | undefined): string {
  const trimmed = (model ?? DEFAULT_MISTRAL_MODEL).trim();
  if (trimmed.length === 0) {
    throw new MistralProviderError("Mistral model must be a non-empty value");
  }

  return trimmed;
}

function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;

  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new MistralProviderError("Mistral baseUrl must be a non-empty value");
  }

  return trimmed;
}

function resolveMaxTokens(maxTokens: number | undefined): number {
  const resolvedMaxTokens = maxTokens ?? DEFAULT_MISTRAL_MAX_TOKENS;

  if (
    !Number.isSafeInteger(resolvedMaxTokens) ||
    resolvedMaxTokens <= 0 ||
    resolvedMaxTokens > MAX_MISTRAL_MAX_TOKENS
  ) {
    throw new MistralProviderError(
      `Mistral maxTokens must be a positive integer no greater than ${String(MAX_MISTRAL_MAX_TOKENS)}`,
    );
  }

  return resolvedMaxTokens;
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolvedTimeoutMs = timeoutMs ?? DEFAULT_MISTRAL_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(resolvedTimeoutMs) ||
    resolvedTimeoutMs <= 0 ||
    resolvedTimeoutMs > MAX_MISTRAL_TIMEOUT_MS
  ) {
    throw new MistralProviderError(
      `Mistral timeoutMs must be a positive integer no greater than ${String(MAX_MISTRAL_TIMEOUT_MS)}`,
    );
  }

  return resolvedTimeoutMs;
}

function resolveMaxAttempts(maxAttempts: number | undefined): number {
  const resolvedMaxAttempts = maxAttempts ?? DEFAULT_MISTRAL_MAX_ATTEMPTS;

  if (!Number.isSafeInteger(resolvedMaxAttempts) || resolvedMaxAttempts <= 0) {
    throw new MistralProviderError("Mistral maxAttempts must be a positive integer");
  }

  return resolvedMaxAttempts;
}
