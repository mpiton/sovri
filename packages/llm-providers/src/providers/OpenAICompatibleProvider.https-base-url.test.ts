// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "../types/LLMProvider.js";

const TestApiKey = "test-openai-compatible-key";
const TestModel = "qwen2.5-coder-32b";
const TestBaseUrl = "https://inference.eu.example/v1";

interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

interface OpenAICompatibleProviderExports {
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
  readonly OpenAIProviderError: ErrorConstructor;
}

describe("OpenAI-compatible HTTPS base URL contract", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.resetModules();
  });

  it("passes the HTTPS baseUrl unchanged to the OpenAI SDK constructor", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given baseUrl is "https://inference.eu.example/v1"
    // When the compatible provider is constructed without an injected client
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
    });

    // Then the OpenAI SDK constructor receives baseURL "https://inference.eu.example/v1"
    // And the provider does not rewrite the URL
    // And provider.name equals "openai-compatible"
    const options = requireRecord(firstItem(sdkConstructorOptions));
    expect(options["baseURL"]).toBe(TestBaseUrl);
    expect(options["apiKey"]).toBe(TestApiKey);
    expect(provider.name).toBe("openai-compatible");
  });

  it("rejects missing baseUrl before SDK construction", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider, OpenAIProviderError } =
      await openAICompatibleProviderExports();

    // Given baseUrl is missing
    // When the compatible provider is constructed without an injected client
    const error = captureError(() =>
      createOpenAICompatibleProvider({ apiKey: TestApiKey, model: TestModel }),
    );

    // Then OpenAIProviderError is thrown
    // And the OpenAI SDK constructor does not receive SDK default-server construction options
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(sdkConstructorOptions).toEqual([]);
  });
});

async function openAICompatibleProviderExports(): Promise<OpenAICompatibleProviderExports> {
  const module = await import("../index.js");
  const createOpenAICompatibleProvider = Reflect.get(module, "createOpenAICompatibleProvider");
  const OpenAIProviderError = Reflect.get(module, "OpenAIProviderError");

  if (typeof createOpenAICompatibleProvider !== "function") {
    throw new Error("createOpenAICompatibleProvider export is missing");
  }
  if (!isErrorConstructor(OpenAIProviderError)) {
    throw new Error("OpenAIProviderError export is missing");
  }

  return { createOpenAICompatibleProvider, OpenAIProviderError };
}

function mockOpenAIModule(sdkConstructorOptions: unknown[]): Record<string, unknown> {
  class MockOpenAI {
    readonly chat = {
      completions: {
        create: async () => {
          throw new Error("Mock OpenAI-compatible client should not receive construction calls");
        },
      },
    };

    constructor(options: unknown) {
      sdkConstructorOptions.push(options);
    }
  }

  class MockAPIError extends Error {}
  class MockAPIConnectionError extends MockAPIError {}
  class MockAPIConnectionTimeoutError extends MockAPIError {}
  class MockAuthenticationError extends MockAPIError {}
  class MockPermissionDeniedError extends MockAPIError {}

  return {
    default: MockOpenAI,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
    APIError: MockAPIError,
    AuthenticationError: MockAuthenticationError,
    PermissionDeniedError: MockPermissionDeniedError,
  };
}

function firstItem(values: readonly unknown[]): unknown {
  const [first] = values;
  if (first === undefined) {
    throw new Error("Expected at least one SDK constructor call");
  }

  return first;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected SDK constructor options to be an object");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected constructor to throw");
}

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}
