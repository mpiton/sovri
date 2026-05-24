// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { SovriConfig } from "@sovri/config";
import { createLogger } from "@sovri/observability";

import { MissingApiKeyError, UnsupportedProviderError } from "./errors.js";
import { AnthropicProvider } from "./providers/AnthropicProvider.js";
import { MistralProvider } from "./providers/MistralProvider.js";
import type { LLMProvider } from "./types/LLMProvider.js";

const logger = createLogger("llm-providers.factory");

export function createProviderFromConfig(config: SovriConfig, env: NodeJS.ProcessEnv): LLMProvider {
  switch (config.llm.provider) {
    case "anthropic":
      logProviderSelection(config);
      return createAnthropicProvider(config, readApiKey(config.llm.apiKeySecret, env));
    case "mistral":
      logProviderSelection(config);
      return createMistralProvider(config, readApiKey(config.llm.apiKeySecret, env));
    default:
      throw new UnsupportedProviderError(config.llm.provider, {
        cause: new Error("Provider is not supported by the provider factory"),
      });
  }
}

function createAnthropicProvider(config: SovriConfig, apiKey: string): AnthropicProvider {
  const options = {
    env: { ANTHROPIC_API_KEY: apiKey },
    model: config.llm.model,
  };

  if (config.llm.baseUrl !== undefined) {
    return new AnthropicProvider({
      ...options,
      baseUrl: config.llm.baseUrl,
    });
  }

  return new AnthropicProvider(options);
}

function createMistralProvider(config: SovriConfig, apiKey: string): MistralProvider {
  if (config.llm.baseUrl !== undefined) {
    return new MistralProvider({
      apiKey,
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
    });
  }

  return new MistralProvider({
    apiKey,
    model: config.llm.model,
  });
}

function logProviderSelection(config: SovriConfig): void {
  logger.info(
    {
      provider: config.llm.provider,
      apiKeySecret: config.llm.apiKeySecret,
    },
    "LLM provider selected",
  );
}

function readApiKey(apiKeySecret: string, env: NodeJS.ProcessEnv): string {
  const apiKey = env[apiKeySecret]?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingApiKeyError(apiKeySecret, {
      cause: new Error("API key environment variable is missing or blank"),
    });
  }

  return apiKey;
}
