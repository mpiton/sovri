// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { SovriConfig } from "@sovri/config";
import { createLogger } from "@sovri/observability";

import { MissingApiKeyError, UnsupportedProviderError } from "./errors.js";
import { AnthropicProvider } from "./providers/AnthropicProvider.js";
import { MistralProvider } from "./providers/MistralProvider.js";
import { createOpenAICompatibleProvider } from "./providers/OpenAICompatibleProvider.js";
import { OpenAIProvider } from "./providers/OpenAIProvider.js";
import type { LLMProvider } from "./types/LLMProvider.js";

const logger = createLogger("llm-providers.factory");

export type ProviderFactoryOptions = {
  readonly timeoutMs?: number;
};

export function createProviderFromConfig(
  config: SovriConfig,
  env: NodeJS.ProcessEnv,
  options: ProviderFactoryOptions = {},
): LLMProvider {
  switch (config.llm.provider) {
    case "anthropic":
      logProviderSelection(config);
      return createAnthropicProvider(config, readApiKey(config.llm.apiKeySecret, env), options);
    case "mistral":
      logProviderSelection(config);
      return createMistralProvider(config, readApiKey(config.llm.apiKeySecret, env), options);
    case "openai":
      logProviderSelection(config);
      return createOpenAIProvider(config, readApiKey(config.llm.apiKeySecret, env), options);
    case "openai-compatible":
      logProviderSelection(config);
      return createOpenAICompatibleProviderFromConfig(
        config,
        readApiKey(config.llm.apiKeySecret, env),
        options,
      );
    default:
      throw new UnsupportedProviderError(config.llm.provider, {
        cause: new Error("Provider is not supported by the provider factory"),
      });
  }
}

function createAnthropicProvider(
  config: SovriConfig,
  apiKey: string,
  factoryOptions: ProviderFactoryOptions,
): AnthropicProvider {
  const options = {
    env: { ANTHROPIC_API_KEY: apiKey },
    model: config.llm.model,
    ...timeoutOptions(factoryOptions),
  };

  if (config.llm.baseUrl !== undefined) {
    return new AnthropicProvider({
      ...options,
      baseUrl: config.llm.baseUrl,
    });
  }

  return new AnthropicProvider(options);
}

function createMistralProvider(
  config: SovriConfig,
  apiKey: string,
  factoryOptions: ProviderFactoryOptions,
): MistralProvider {
  const options = {
    apiKey,
    model: config.llm.model,
    ...timeoutOptions(factoryOptions),
  };

  if (config.llm.baseUrl !== undefined) {
    return new MistralProvider({
      ...options,
      baseUrl: config.llm.baseUrl,
    });
  }

  return new MistralProvider(options);
}

function createOpenAIProvider(
  config: SovriConfig,
  apiKey: string,
  factoryOptions: ProviderFactoryOptions,
): OpenAIProvider {
  const options = {
    apiKey,
    model: config.llm.model,
    ...timeoutOptions(factoryOptions),
  };

  if (config.llm.baseUrl !== undefined) {
    return new OpenAIProvider({
      ...options,
      baseUrl: config.llm.baseUrl,
    });
  }

  return new OpenAIProvider(options);
}

function createOpenAICompatibleProviderFromConfig(
  config: SovriConfig,
  apiKey: string,
  factoryOptions: ProviderFactoryOptions,
): LLMProvider {
  return createOpenAICompatibleProvider({
    apiKey,
    model: config.llm.model,
    baseUrl: readOpenAICompatibleBaseUrl(config),
    ...timeoutOptions(factoryOptions),
  });
}

function readOpenAICompatibleBaseUrl(config: SovriConfig): string {
  if (config.llm.baseUrl === undefined) {
    throw new UnsupportedProviderError(config.llm.provider, {
      cause: new Error("OpenAI-compatible provider requires llm.baseUrl"),
    });
  }

  return config.llm.baseUrl;
}

function timeoutOptions(options: ProviderFactoryOptions): { readonly timeoutMs?: number } {
  if (options.timeoutMs === undefined) {
    return {};
  }

  return { timeoutMs: options.timeoutMs };
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
