// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export type { Severity } from "@sovri/core";
export type { Logger } from "@sovri/observability";

export type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
  TokenUsage,
} from "./types/LLMProvider.js";

export {
  AnthropicAuthError,
  AnthropicResponseError,
  AnthropicRetryError,
  AnthropicTimeoutError,
  MissingApiKeyError,
  UnsupportedProviderError,
  type AnthropicProviderErrorOptions,
  type AnthropicResponseErrorOptions,
  type FactoryProviderErrorOptions,
} from "./errors.js";

export { createProviderFromConfig } from "./factory.js";

export {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  MAX_ANTHROPIC_MAX_TOKENS,
  type AnthropicProviderOptions,
} from "./providers/AnthropicProvider.js";

export {
  DEFAULT_MISTRAL_MAX_TOKENS,
  DEFAULT_MISTRAL_MODEL,
  DEFAULT_MISTRAL_TIMEOUT_MS,
  MAX_MISTRAL_MAX_TOKENS,
  MistralProvider,
  MistralProviderError,
  MistralProviderRetryError,
  MistralProviderTimeoutError,
  type MistralProviderErrorOptions,
  type MistralProviderOptions,
} from "./providers/MistralProvider.js";

export {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./providers/OpenAICompatibleProvider.js";

export {
  DEFAULT_OPENAI_MAX_ATTEMPTS,
  DEFAULT_OPENAI_MAX_TOKENS,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  MAX_OPENAI_MAX_ATTEMPTS,
  MAX_OPENAI_MAX_TOKENS,
  MAX_OPENAI_TIMEOUT_MS,
  OpenAIProvider,
  OpenAIProviderAuthError,
  OpenAIProviderError,
  OpenAIProviderRetryError,
  OpenAIProviderTimeoutError,
  type OpenAIProviderErrorOptions,
  type OpenAIProviderOptions,
} from "./providers/OpenAIProvider.js";

export {
  LLMFindingSchema,
  LLMResponseSchema,
  type LLMFinding,
  type LLMResponse,
} from "./schemas/LLMResponseSchema.js";

export {
  zodToProviderJsonSchema,
  type ProviderJsonSchema,
} from "./helpers/provider-json-schema.js";

export {
  retryWithBackoff,
  RetryExhaustedError,
  RetryTimeoutError,
  type AttemptContext,
  type RetryErrorOptions,
  type RetryOptions,
} from "./helpers/retry.js";
