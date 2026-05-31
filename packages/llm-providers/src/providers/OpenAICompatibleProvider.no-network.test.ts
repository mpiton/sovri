// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdir, readFile } from "node:fs/promises";

import { z } from "@sovri/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";

const ProvidersDir = new URL(".", import.meta.url);
const ThisTestFileName = "OpenAICompatibleProvider.no-network.test.ts";
const TestApiKey = "test-openai-compatible-key";
const TestBaseUrl = "https://compatible.test/v1";
const PublicOpenAIHost = ["api", "openai", "com"].join(".");

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

type ReviewData = z.infer<typeof ReviewParams.schema>;

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly client?: FakeOpenAIChatClient;
}

interface OpenAICompatibleProviderExports {
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
  readonly OpenAIProviderError: ErrorConstructor;
}

interface ForbiddenCompatibleNetworkPattern {
  readonly label: string;
  readonly matches: (source: string) => boolean;
  readonly sample: string;
}

const ForbiddenCompatibleNetworkPatterns = [
  {
    label: `https://${PublicOpenAIHost}`,
    matches: (source) => source.toLowerCase().includes(PublicOpenAIHost),
    sample: `https://${PublicOpenAIHost}`,
  },
  {
    label: "process.env.OPENAI_API_KEY",
    matches: (source) => /\bOPENAI_API_KEY\b/.test(source),
    sample: "process.env.OPENAI_API_KEY",
  },
  {
    label: "process.env.OPENAI_COMPATIBLE_API_KEY",
    matches: (source) => /\bOPENAI_COMPATIBLE_API_KEY\b/.test(source),
    sample: "process.env.OPENAI_COMPATIBLE_API_KEY",
  },
] satisfies readonly ForbiddenCompatibleNetworkPattern[];

const ForbiddenEnvironmentLookupSamples = [
  ['process.env["OPENAI_API_KEY"]', "process.env.OPENAI_API_KEY"],
  ["const { OPENAI_API_KEY } = process.env;", "process.env.OPENAI_API_KEY"],
  ['process.env["OPENAI_COMPATIBLE_API_KEY"]', "process.env.OPENAI_COMPATIBLE_API_KEY"],
  ["const { OPENAI_COMPATIBLE_API_KEY } = process.env;", "process.env.OPENAI_COMPATIBLE_API_KEY"],
] satisfies ReadonlyArray<readonly [string, string]>;

afterEach(() => {
  vi.doUnmock("openai");
  vi.resetModules();
});

describe("OpenAI-compatible no-network test guard", () => {
  it("keeps compatible provider behavior tests on injected fake clients", async () => {
    const calls: unknown[] = [];
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given the compatible provider tests are colocated under "packages/llm-providers/src/providers"
    // And the test API key is "test-openai-compatible-key"
    // And the test baseUrl is "https://compatible.test/v1"
    // Given the fake compatible client returns content "{\"summary\":\"Reviewed\"}"
    // And the fake compatible client reports 123 prompt tokens and 45 completion tokens
    const provider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(calls),
    });

    // When the compatible provider tests call generateStructuredWithUsage
    const result = await generateStructuredWithUsage<ReviewData>(provider);

    // Then exactly 1 fake client call is observed
    // And no real OpenAI SDK network request is attempted
    // And no real API key environment variable is read
    expect(result.data).toEqual({ summary: "Reviewed" });
    expect(result.tokenUsage).toEqual({ prompt: 123, completion: 45 });
    expect(calls).toHaveLength(1);
    expect(committedSourceViolations(await readOpenAICompatibleProviderTestSources())).toEqual([]);
  });

  it.each(ForbiddenCompatibleNetworkPatterns)(
    "rejects forbidden OpenAI-compatible provider network pattern $label",
    ({ label, sample }) => {
      // Given a compatible provider test file contains "<forbidden_pattern>"
      const source = `createOpenAICompatibleProvider({ apiKey: "${TestApiKey}", baseUrl: "${TestBaseUrl}" });\n${sample}`;

      // When the no-network test guard runs
      const violations = findForbiddenCompatibleNetworkPatterns(source);

      // Then the guard fails
      // And the failure identifies "<forbidden_pattern>" as incompatible with provider unit tests
      expect(violations).toContain(label);
    },
  );

  it.each(ForbiddenEnvironmentLookupSamples)(
    "rejects API-key environment lookup variant %s",
    (sample, label) => {
      const violations = findForbiddenCompatibleNetworkPatterns(sample);

      expect(violations).toContain(label);
    },
  );

  it("keeps committed compatible provider tests free of real network dependencies", async () => {
    const sources = await readOpenAICompatibleProviderTestSources();

    expect(committedSourceViolations(sources)).toEqual([]);
  });

  it("rejects missing baseUrl before fake client or SDK construction", async () => {
    const calls: unknown[] = [];
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider, OpenAIProviderError } =
      await openAICompatibleProviderExports();

    // Given baseUrl is missing
    // When the compatible provider is constructed without an injected client
    const error = captureError(() =>
      createOpenAICompatibleProvider({ apiKey: TestApiKey, client: fakeOpenAIClient(calls) }),
    );

    // Then OpenAIProviderError is thrown
    // And the fake compatible client receives 0 calls
    // And the OpenAI SDK constructor receives 0 calls
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(calls).toEqual([]);
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

function fakeOpenAIClient(calls: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          calls.push(request);
          return {
            choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
            usage: {
              prompt_tokens: 123,
              completion_tokens: 45,
            },
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
          throw new Error("Mock OpenAI-compatible client should not receive requests");
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

async function readOpenAICompatibleProviderTestSources(): Promise<ProviderTestSource[]> {
  const fileNames = (await readdir(ProvidersDir))
    .filter(
      (fileName) =>
        fileName.startsWith("OpenAICompatibleProvider.") &&
        fileName.endsWith(".test.ts") &&
        fileName !== ThisTestFileName,
    )
    .toSorted();

  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      source: await readFile(new URL(fileName, ProvidersDir), "utf8"),
    })),
  );
}

interface ProviderTestSource {
  readonly fileName: string;
  readonly source: string;
}

function committedSourceViolations(sources: ReadonlyArray<ProviderTestSource>): string[] {
  return sources.flatMap((source) =>
    findForbiddenCompatibleNetworkPatterns(source.source).map(
      (forbiddenPattern) => `${source.fileName}: ${forbiddenPattern}`,
    ),
  );
}

function findForbiddenCompatibleNetworkPatterns(source: string): string[] {
  return ForbiddenCompatibleNetworkPatterns.filter(({ matches }) => matches(source)).map(
    ({ label }) => label,
  );
}

function generateStructuredWithUsage<T>(provider: LLMProvider): Promise<StructuredGeneration<T>> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage<T>(ReviewParams);
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
