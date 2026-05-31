// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { ClientOptions } from "openai";

import { OpenAIProviderAuthError, OpenAIProviderError } from "./OpenAIProvider.errors.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_OPENAI_MAX_TOKENS = 4096;
export const MAX_OPENAI_MAX_TOKENS = 64_000;
export const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
export const MAX_OPENAI_TIMEOUT_MS = 2_147_483_647;
export const DEFAULT_OPENAI_MAX_ATTEMPTS = 3;
export const MAX_OPENAI_MAX_ATTEMPTS = 10;

export interface OpenAIProviderConfigOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export interface ResolvedOpenAIProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string | undefined;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
}

export function resolveOpenAIProviderOptions(
  options: OpenAIProviderConfigOptions,
): ResolvedOpenAIProviderOptions {
  return {
    apiKey: resolveApiKey(options.apiKey),
    model: resolveModel(options.model),
    baseUrl: resolveBaseUrl(options.baseUrl),
    maxTokens: resolveMaxTokens(options.maxTokens),
    timeoutMs: resolveTimeoutMs(options.timeoutMs),
    maxAttempts: resolveMaxAttempts(options.maxAttempts),
  };
}

export function createOpenAIClientOptions(
  apiKey: string,
  timeoutMs: number,
  baseUrl: string | undefined,
): ClientOptions {
  const clientOptions: ClientOptions = {
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  };

  if (baseUrl !== undefined) {
    clientOptions.baseURL = baseUrl;
  }

  return clientOptions;
}

export function resolveMaxTokens(maxTokens: number | undefined): number {
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

function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) {
    return undefined;
  }

  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new OpenAIProviderError("OpenAI baseUrl must be a non-empty value");
  }

  return trimmed;
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolvedTimeoutMs = timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(resolvedTimeoutMs) ||
    resolvedTimeoutMs <= 0 ||
    resolvedTimeoutMs > MAX_OPENAI_TIMEOUT_MS
  ) {
    throw new OpenAIProviderError(
      `OpenAI timeoutMs must be a positive integer no greater than ${String(MAX_OPENAI_TIMEOUT_MS)}`,
    );
  }

  return resolvedTimeoutMs;
}

function resolveMaxAttempts(maxAttempts: number | undefined): number {
  const resolvedMaxAttempts = maxAttempts ?? DEFAULT_OPENAI_MAX_ATTEMPTS;

  if (
    !Number.isSafeInteger(resolvedMaxAttempts) ||
    resolvedMaxAttempts <= 0 ||
    resolvedMaxAttempts > MAX_OPENAI_MAX_ATTEMPTS
  ) {
    throw new OpenAIProviderError(
      `OpenAI maxAttempts must be a positive integer no greater than ${String(MAX_OPENAI_MAX_ATTEMPTS)}`,
    );
  }

  return resolvedMaxAttempts;
}
