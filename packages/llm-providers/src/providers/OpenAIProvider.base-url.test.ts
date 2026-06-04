// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "../types/LLMProvider.js";
import {
  captureError,
  mockOpenAIModule,
} from "../../test/providers/OpenAICompatibleProvider.mock-helper.js";

const TestApiKey = "test-openai-key";
const TestModel = "gpt-5.5";
const TestBaseUrl = "https://openai.eu.example/v1";

interface OpenAIProviderConstructorOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

interface OpenAIProviderConstructor {
  new (options: OpenAIProviderConstructorOptions): LLMProvider;
}

interface OpenAIProviderExports {
  readonly OpenAIProvider: OpenAIProviderConstructor;
  readonly OpenAIProviderError: ErrorConstructor;
}

describe("OpenAIProvider base URL override acceptance", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.resetModules();
  });

  it("uses the OpenAI SDK default server URL when baseUrl is omitted", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { OpenAIProvider } = await openAIProviderExports();

    // Given apiKey is "test-openai-key"
    // And model is "gpt-5.5"
    // When an OpenAIProvider is constructed without baseUrl and without an injected client
    const provider = new OpenAIProvider({ apiKey: TestApiKey, model: TestModel });

    // Then the OpenAI SDK constructor does not receive a baseURL option
    // And provider.name equals "openai"
    // And provider.model equals "gpt-5.5"
    const options = requireRecord(firstItem(sdkConstructorOptions));
    expect(Object.hasOwn(options, "baseURL")).toBe(false);
    expect(provider.name).toBe("openai");
    expect(provider.model).toBe(TestModel);
  });

  it("throws a typed error for blank baseUrl before SDK construction", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { OpenAIProvider, OpenAIProviderError } = await openAIProviderExports();

    // Given baseUrl is "   "
    // When an OpenAIProvider is constructed without an injected client
    const error = captureError(
      () => new OpenAIProvider({ apiKey: TestApiKey, model: TestModel, baseUrl: "   " }),
    );

    // Then OpenAIProviderError is thrown
    // And the error message contains "OpenAI baseUrl must be a non-empty value"
    // And the OpenAI SDK constructor receives 0 calls
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("OpenAI baseUrl must be a non-empty value"),
      }),
    );
    expect(sdkConstructorOptions).toEqual([]);
  });

  it.each([
    ["foo", "valid absolute URL"],
    ["http//bad", "valid absolute URL"],
    ["file:///tmp/openai", "must use http or https"],
  ])("throws a typed error for invalid baseUrl %s", async (baseUrl, messageFragment) => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { OpenAIProvider, OpenAIProviderError } = await openAIProviderExports();

    const error = captureError(
      () => new OpenAIProvider({ apiKey: TestApiKey, model: TestModel, baseUrl }),
    );

    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(messageFragment),
      }),
    );
    expect(sdkConstructorOptions).toEqual([]);
  });

  it("passes the provided baseUrl to the OpenAI SDK constructor", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { OpenAIProvider } = await openAIProviderExports();

    // Given baseUrl is "https://openai.eu.example/v1"
    // When an OpenAIProvider is constructed without an injected client
    const provider = new OpenAIProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
    });
    void provider;

    // Then the OpenAI SDK constructor receives baseURL "https://openai.eu.example/v1"
    // And the OpenAI SDK constructor receives apiKey "test-openai-key"
    // And the OpenAI SDK constructor receives timeout 60000
    // And the OpenAI SDK constructor receives maxRetries 0
    const options = requireRecord(firstItem(sdkConstructorOptions));
    expect(options["baseURL"]).toBe(TestBaseUrl);
    expect(options["apiKey"]).toBe(TestApiKey);
    expect(options["timeout"]).toBe(60_000);
    expect(options["maxRetries"]).toBe(0);
  });
});

async function openAIProviderExports(): Promise<OpenAIProviderExports> {
  const module = await import("../index.js");
  const OpenAIProvider = Reflect.get(module, "OpenAIProvider");
  const OpenAIProviderError = Reflect.get(module, "OpenAIProviderError");

  if (!isOpenAIProviderConstructor(OpenAIProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }
  if (!isErrorConstructor(OpenAIProviderError)) {
    throw new Error("OpenAIProviderError export is missing");
  }

  return { OpenAIProvider, OpenAIProviderError };
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

function firstItem(items: ReadonlyArray<unknown>): unknown {
  const [item] = items;
  if (item === undefined) {
    throw new Error("Expected at least one captured item");
  }

  return item;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected value to be an object record");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
