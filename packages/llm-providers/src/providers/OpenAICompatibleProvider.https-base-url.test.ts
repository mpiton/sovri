// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import { openAICompatibleProviderExports } from "../../test/providers/OpenAICompatibleProvider.exports-helper.js";
import {
  captureError,
  mockOpenAIModule,
} from "../../test/providers/OpenAICompatibleProvider.mock-helper.js";

const TestApiKey = "test-openai-compatible-key";
const TestModel = "qwen2.5-coder-32b";
const TestBaseUrl = "https://inference.eu.example/v1";
const PlaintextBaseUrl = "http://inference.eu.example/v1";

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

  it("rejects non-HTTPS baseUrl before SDK construction", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider, OpenAIProviderError } =
      await openAICompatibleProviderExports();

    // Given baseUrl is "http://inference.eu.example/v1"
    // When the compatible provider is constructed without an injected client
    const error = captureError(() =>
      createOpenAICompatibleProvider({
        apiKey: TestApiKey,
        model: TestModel,
        baseUrl: PlaintextBaseUrl,
      }),
    );

    // Then OpenAIProviderError is thrown
    // And the OpenAI SDK constructor receives 0 calls
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("OpenAI-compatible baseUrl must use https"),
      }),
    );
    expect(sdkConstructorOptions).toEqual([]);
  });
});

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
