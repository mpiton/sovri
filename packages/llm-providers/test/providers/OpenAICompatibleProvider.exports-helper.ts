// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { LLMProvider } from "../../src/types/LLMProvider.js";
import type { FakeOpenAIChatClient } from "./OpenAICompatibleProvider.mock-helper.js";

export interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly client?: FakeOpenAIChatClient;
}

export interface OpenAICompatibleProviderExports {
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
  readonly OpenAIProviderError: ErrorConstructor;
}

export async function openAICompatibleProviderExports(): Promise<OpenAICompatibleProviderExports> {
  const module = await import("../../src/index.js");
  const createOpenAICompatibleProvider = Reflect.get(module, "createOpenAICompatibleProvider");
  const OpenAIProviderError = Reflect.get(module, "OpenAIProviderError");

  if (typeof createOpenAICompatibleProvider !== "function") {
    throw new Error("createOpenAICompatibleProvider export is missing");
  }
  if (!isErrorConstructor(OpenAIProviderError)) {
    throw new Error("OpenAIProviderError export is missing");
  }

  return {
    createOpenAICompatibleProvider: (options) =>
      requireLLMProvider(Reflect.apply(createOpenAICompatibleProvider, undefined, [options])),
    OpenAIProviderError,
  };
}

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

function requireLLMProvider(value: unknown): LLMProvider {
  if (!isLLMProvider(value)) {
    throw new Error("createOpenAICompatibleProvider returned an invalid provider");
  }

  return value;
}

function isLLMProvider(value: unknown): value is LLMProvider {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["name"] === "string" &&
    typeof value["model"] === "string" &&
    typeof value["maxTokens"] === "number" &&
    typeof value["generateStructured"] === "function"
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
