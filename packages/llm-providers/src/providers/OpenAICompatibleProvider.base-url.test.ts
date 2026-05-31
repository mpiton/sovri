// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openAICompatibleProviderExports,
  type OpenAICompatibleProviderOptions,
} from "../../test/providers/OpenAICompatibleProvider.exports-helper.js";
import {
  captureError,
  type FakeOpenAIChatClient,
  mockOpenAIModule,
} from "../../test/providers/OpenAICompatibleProvider.mock-helper.js";

const TestApiKey = "test-openai-compatible-key";
const TestModel = "llama-3.3-70b-instruct";
const TestBaseUrl = "https://vllm.eu.example/v1";
const DefaultMaxTokens = 4096;
const MissingBaseUrl = Symbol("missing baseUrl");

type BaseUrlInput = typeof MissingBaseUrl | string;

const InvalidBaseUrls = [
  ["missing", MissingBaseUrl],
  ['""', ""],
  ['"   "', "   "],
] satisfies ReadonlyArray<readonly [string, BaseUrlInput]>;

describe("OpenAI-compatible base URL acceptance", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.resetModules();
  });

  it("constructs an OpenAI-compatible provider when baseUrl is present", async () => {
    const requests: unknown[] = [];
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given the compatible provider helper is "createOpenAICompatibleProvider"
    // And apiKey is "test-openai-compatible-key"
    // And model is "llama-3.3-70b-instruct"
    // Given baseUrl is "https://vllm.eu.example/v1"
    // When the compatible provider is constructed with an injected fake client
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      model: TestModel,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(requests),
    });

    // Then provider.name equals "openai-compatible"
    // And provider.model equals "llama-3.3-70b-instruct"
    // And provider.maxTokens equals 4096
    // And no OpenAI chat completion request is attempted during construction
    expect(provider.name).toBe("openai-compatible");
    expect(provider.model).toBe(TestModel);
    expect(provider.maxTokens).toBe(DefaultMaxTokens);
    expect(requests).toEqual([]);
  });

  it.each(InvalidBaseUrls)(
    "throws before any request when baseUrl is %s",
    async (_caseName, baseUrl) => {
      const requests: unknown[] = [];
      const { createOpenAICompatibleProvider, OpenAIProviderError } =
        await openAICompatibleProviderExports();

      // Given baseUrl is <base_url>
      // When the compatible provider is constructed with an injected fake client
      const error = captureError(() =>
        createOpenAICompatibleProvider(providerOptions(baseUrl, requests)),
      );

      // Then OpenAIProviderError is thrown
      // And the error message contains "OpenAI-compatible baseUrl must be a non-empty value"
      // And the fake OpenAI-compatible client receives 0 calls
      expect(error).toBeInstanceOf(OpenAIProviderError);
      expect(error).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("OpenAI-compatible baseUrl must be a non-empty value"),
        }),
      );
      expect(requests).toEqual([]);
    },
  );

  it("rejects missing baseUrl before OpenAI SDK construction", async () => {
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
    // And the OpenAI SDK constructor receives 0 calls
    // And no request can fall back to the public OpenAI endpoint
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(sdkConstructorOptions).toEqual([]);
  });
});

function providerOptions(
  baseUrl: BaseUrlInput,
  requests: unknown[],
): OpenAICompatibleProviderOptions {
  const options = {
    apiKey: TestApiKey,
    model: TestModel,
    client: fakeOpenAIClient(requests),
  };

  if (baseUrl === MissingBaseUrl) {
    return options;
  }

  return { ...options, baseUrl };
}

function fakeOpenAIClient(requests: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          requests.push(request);
          throw new Error("Fake OpenAI-compatible client should not receive construction calls");
        },
      },
    },
  };
}
