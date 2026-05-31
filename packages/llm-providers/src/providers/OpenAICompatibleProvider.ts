// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { GenerateStructuredParams, LLMProvider } from "../types/LLMProvider.js";
import { OpenAIProvider, type OpenAIProviderOptions } from "./OpenAIProvider.js";
import { OpenAIProviderError } from "./OpenAIProvider.errors.js";

export interface OpenAICompatibleProviderOptions extends OpenAIProviderOptions {
  readonly baseUrl: string;
}

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

  return trimmed;
}
