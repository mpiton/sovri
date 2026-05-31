// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { GenerateStructuredParams, LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProvider, type OpenAIProviderOptions } from "./OpenAIProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";

/**
 * Configuration for an OpenAI-compatible provider endpoint.
 */
export interface OpenAICompatibleProviderOptions extends OpenAIProviderOptions {
  /**
   * Absolute HTTPS endpoint for the OpenAI-compatible server.
   */
  readonly baseUrl: string;
}

/**
 * Creates an `LLMProvider` backed by a caller-supplied OpenAI-compatible HTTPS endpoint.
 *
 * @param options - API key, model settings, retry/timeout settings, and required HTTPS `baseUrl`.
 * @returns An `LLMProvider` named `openai-compatible`.
 *
 * @example
 * ```ts
 * const provider = createOpenAICompatibleProvider({
 *   apiKey: "test-key",
 *   baseUrl: "https://inference.eu.example/v1",
 * });
 * ```
 */
export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): LLMProvider {
  const provider = new OpenAIProvider({
    ...options,
    baseUrl: requireOpenAICompatibleBaseUrl(options.baseUrl),
  });

  return {
    name: "openai-compatible",
    model: provider.model,
    maxTokens: provider.maxTokens,
    generateStructured: <T>(params: GenerateStructuredParams<T>) =>
      provider.generateStructured(params),
    generateStructuredWithUsage: <T>(params: GenerateStructuredParams<T>) =>
      provider.generateStructuredWithUsage(params),
  };
}

function requireOpenAICompatibleBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new OpenAIProviderError("OpenAI-compatible baseUrl must be a non-empty value");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (cause) {
    throw new OpenAIProviderError("OpenAI-compatible baseUrl must be a valid absolute URL", {
      cause,
    });
  }

  if (parsed.protocol !== "https:") {
    throw new OpenAIProviderError("OpenAI-compatible baseUrl must use https");
  }
  if (parsed.hostname.length === 0) {
    throw new OpenAIProviderError("OpenAI-compatible baseUrl must include a hostname");
  }

  return trimmed;
}
