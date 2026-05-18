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
  type AnthropicProviderErrorOptions,
  type AnthropicResponseErrorOptions,
} from "./errors.js";

export {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  MAX_ANTHROPIC_MAX_TOKENS,
  type AnthropicProviderOptions,
} from "./providers/AnthropicProvider.js";

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
