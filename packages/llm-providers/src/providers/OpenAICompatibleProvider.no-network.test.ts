// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Guard rail tests that keep the OpenAI-compatible provider suite on injected clients and fixture
 * credentials.
 */
import { z } from "@sovri/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompatibleProviderFixture,
  committedSourceViolations,
  readOpenAICompatibleProviderTestSources,
} from "../../test/providers/OpenAICompatibleProvider.no-network-guard.js";
import { openAICompatibleProviderExports } from "../../test/providers/OpenAICompatibleProvider.exports-helper.js";
import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";
import {
  captureError,
  type FakeOpenAIChatClient,
  mockOpenAIModule,
} from "../../test/providers/OpenAICompatibleProvider.mock-helper.js";

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};
const ReviewTokenUsage = { prompt: 123, completion: 45 };

type ReviewData = z.infer<typeof ReviewParams.schema>;

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
      apiKey: CompatibleProviderFixture.apiKey,
      baseUrl: CompatibleProviderFixture.baseUrl,
      client: fakeOpenAIClient(calls),
    });

    // When the compatible provider tests call generateStructuredWithUsage
    const result = await generateStructuredWithUsage<ReviewData>(provider);

    // Then exactly 1 fake client call is observed
    // And no real OpenAI SDK network request is attempted
    // And no real API key environment variable is read
    expect(result.data).toEqual({ summary: "Reviewed" });
    expect(result.tokenUsage).toEqual(ReviewTokenUsage);
    expect(calls).toHaveLength(1);
    expect(committedSourceViolations(await readOpenAICompatibleProviderTestSources())).toEqual([]);
  });

  it("keeps committed compatible provider tests free of real network dependencies", async () => {
    const sources = await readOpenAICompatibleProviderTestSources();

    expect(committedSourceViolations(sources)).toEqual([]);
  });

  it("includes the compatible export acceptance test in committed no-network checks", async () => {
    const sources = await readOpenAICompatibleProviderTestSources();

    expect(sources.map((source) => source.fileName)).toContain(
      "OpenAIProvider.compatible.exports.test.ts",
    );
  });

  it("rejects missing baseUrl before SDK construction", async () => {
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider, OpenAIProviderError } =
      await openAICompatibleProviderExports();

    // Given baseUrl is missing
    // When the compatible provider is constructed without an injected client
    const error = captureError(() =>
      createOpenAICompatibleProvider({
        apiKey: CompatibleProviderFixture.apiKey,
      }),
    );

    // Then OpenAIProviderError is thrown
    // And the OpenAI SDK constructor receives 0 calls
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(sdkConstructorOptions).toEqual([]);
  });
});

function fakeOpenAIClient(calls: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          calls.push(request);
          return {
            choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
            usage: {
              prompt_tokens: ReviewTokenUsage.prompt,
              completion_tokens: ReviewTokenUsage.completion,
            },
          };
        },
      },
    },
  };
}

function generateStructuredWithUsage<T>(provider: LLMProvider): Promise<StructuredGeneration<T>> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage<T>(ReviewParams);
}
