// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "../types/LLMProvider.js";

const TestApiKey = "test-openai-key";

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAIProviderConstructor {
  new (options: { readonly apiKey: string; readonly client?: FakeOpenAIChatClient }): LLMProvider;
}

interface OpenAIProviderExports {
  readonly OpenAIProvider: OpenAIProviderConstructor;
  readonly OpenAIProviderAuthError: ErrorConstructor;
}

describe("OpenAIProvider API key validation acceptance", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.resetModules();
  });

  it("constructs with a non-empty API key without chat completion requests", async () => {
    const { OpenAIProvider } = await openAIProviderExports();
    const requests: unknown[] = [];

    // Given apiKey is "test-openai-key"
    // When an OpenAIProvider is constructed with the injected fake client
    const provider = new OpenAIProvider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient(requests),
    });

    // Then construction succeeds
    // And provider.name equals "openai"
    // And the fake OpenAI client receives 0 requests during construction
    expect(provider.name).toBe("openai");
    expect(requests).toEqual([]);
  });

  it.each(["", "   "])(
    "throws a typed auth error for apiKey literal %j before requests",
    async (apiKey) => {
      const { OpenAIProvider, OpenAIProviderAuthError } = await openAIProviderExports();
      const requests: unknown[] = [];

      // Given apiKey literal is <api_key_literal>
      // When an OpenAIProvider is constructed with the injected fake client
      const error = captureError(
        () =>
          new OpenAIProvider({
            apiKey,
            client: fakeOpenAIClient(requests),
          }),
      );

      // Then OpenAIProviderAuthError is thrown
      // And the error message contains "OpenAI apiKey must be a non-empty value"
      // And the fake OpenAI client receives 0 requests
      expect(error).toBeInstanceOf(OpenAIProviderAuthError);
      expect(error).toEqual(
        expect.objectContaining({
          message: expect.stringContaining("OpenAI apiKey must be a non-empty value"),
        }),
      );
      expect(requests).toEqual([]);
    },
  );

  it("trims whitespace before constructing the OpenAI SDK client", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { OpenAIProvider } = await openAIProviderExports();

    // Given apiKey is "  test-openai-key  "
    // When an OpenAIProvider is constructed without an injected client
    const provider = new OpenAIProvider({ apiKey: `  ${TestApiKey}  ` });
    void provider;

    // Then the OpenAI SDK constructor receives apiKey "test-openai-key"
    // And the SDK constructor receives maxRetries 0
    const options = requireRecord(firstItem(sdkConstructorOptions));
    expect(options["apiKey"]).toBe(TestApiKey);
    expect(options["maxRetries"]).toBe(0);
  });
});

async function openAIProviderExports(): Promise<OpenAIProviderExports> {
  const module = await import("../index.js");
  const OpenAIProvider = Reflect.get(module, "OpenAIProvider");
  const OpenAIProviderAuthError = Reflect.get(module, "OpenAIProviderAuthError");

  if (!isOpenAIProviderConstructor(OpenAIProvider)) {
    throw new Error("OpenAIProvider export is missing");
  }
  if (!isErrorConstructor(OpenAIProviderAuthError)) {
    throw new Error("OpenAIProviderAuthError export is missing");
  }

  return { OpenAIProvider, OpenAIProviderAuthError };
}

function isOpenAIProviderConstructor(value: unknown): value is OpenAIProviderConstructor {
  return typeof value === "function";
}

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

function fakeOpenAIClient(requests: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
          };
        },
      },
    },
  };
}

function mockOpenAIModule(sdkConstructorOptions: unknown[]): Record<string, unknown> {
  class MockOpenAI {
    readonly chat = {
      completions: {
        create: async () => {
          throw new Error("Mock OpenAI client should not receive requests during construction");
        },
      },
    };

    constructor(options: unknown) {
      sdkConstructorOptions.push(options);
    }
  }

  class MockAPIError extends Error {}
  class MockAuthenticationError extends MockAPIError {}
  class MockPermissionDeniedError extends MockAPIError {}

  return {
    default: MockOpenAI,
    APIError: MockAPIError,
    AuthenticationError: MockAuthenticationError,
    PermissionDeniedError: MockPermissionDeniedError,
  };
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected constructor to throw");
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
