// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "./providers/AnthropicProvider.js";
import { MistralProvider } from "./providers/MistralProvider.js";

import {
  createProviderFromConfig,
  MissingApiKeyError,
  UnsupportedProviderError,
  type LLMProvider,
} from "./index.js";

vi.mock("./providers/AnthropicProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/AnthropicProvider.js")>();
  const Real = actual.AnthropicProvider;
  const Spy = vi.fn(function constructAnthropicProvider(
    options: ConstructorParameters<typeof Real>[0],
  ) {
    return new Real(options);
  });

  return { ...actual, AnthropicProvider: Spy };
});

vi.mock("./providers/MistralProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/MistralProvider.js")>();
  const Real = actual.MistralProvider;
  const Spy = vi.fn(function constructMistralProvider(
    options: ConstructorParameters<typeof Real>[0],
  ) {
    return new Real(options);
  });

  return { ...actual, MistralProvider: Spy };
});

describe("createProviderFromConfig", () => {
  afterEach(() => {
    vi.mocked(AnthropicProvider).mockClear();
    vi.mocked(MistralProvider).mockClear();
  });

  it.each([
    {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      secretName: "ANTHROPIC_API_KEY",
    },
    {
      provider: "mistral",
      model: "mistral-large-latest",
      secretName: "MISTRAL_API_KEY",
    },
  ] as const)(
    "creates the $provider provider from Sovri config",
    ({ model, provider, secretName }) => {
      // Given a Sovri config with llm.provider "<provider>"
      // And llm.model "<model>"
      // And llm.apiKeySecret "<secretName>"
      const config = createConfig({ provider, model, apiKeySecret: secretName });

      // And process env contains "<secretName>" with value "test-key"
      const env = { [secretName]: "test-key" };

      // When createProviderFromConfig is called with the config and process env
      const createdProvider: LLMProvider = createProviderFromConfig(config, env);

      // Then the returned value satisfies the LLMProvider contract
      expect(createdProvider.generateStructured).toBeTypeOf("function");
      expect(createdProvider.model).toBeTypeOf("string");
      expect(createdProvider.model).toBe(model);

      // And the returned provider name equals "<provider>"
      expect(createdProvider.name).toBe(provider);
    },
  );

  it.each([
    {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      secretName: "ANTHROPIC_API_KEY",
      baseUrl: "https://anthropic.internal.example",
    },
    {
      provider: "mistral",
      model: "mistral-large-latest",
      secretName: "MISTRAL_API_KEY",
      baseUrl: "https://mistral.internal.example",
    },
  ] as const)(
    "forwards the configured baseUrl to the $provider provider constructor",
    ({ baseUrl, model, provider, secretName }) => {
      const config = createConfig({ provider, model, apiKeySecret: secretName, baseUrl });
      const env = { [secretName]: "test-key" };

      createProviderFromConfig(config, env);

      const constructorSpy =
        provider === "anthropic" ? vi.mocked(AnthropicProvider) : vi.mocked(MistralProvider);

      expect(constructorSpy).toHaveBeenCalledTimes(1);
      const options = constructorSpy.mock.calls[0]?.[0];
      expect(options).toMatchObject({ baseUrl, model });
    },
  );

  it("throws a typed missing-key error when the configured env var is absent", () => {
    const config = createConfig({
      provider: "mistral",
      model: "mistral-large-latest",
      apiKeySecret: "MISTRAL_API_KEY",
    });

    expect(() => createProviderFromConfig(config, {})).toThrow(MissingApiKeyError);
  });

  it("throws a typed unsupported-provider error for future provider values", () => {
    const config = createConfig({
      provider: "openai",
      model: "gpt-4.1",
      apiKeySecret: "OPENAI_API_KEY",
    });

    expect(() => createProviderFromConfig(config, {})).toThrow(UnsupportedProviderError);
  });
});

function createConfig(llm: {
  readonly provider: "anthropic" | "mistral" | "openai" | "openai-compatible";
  readonly model: string;
  readonly apiKeySecret: string;
  readonly baseUrl?: string;
}) {
  return {
    llm,
    review: {
      mode: "full",
      autoReviewDrafts: false,
      severityThreshold: "minor",
    },
    ignores: [],
    limits: {
      maxFilesPerReview: 50,
      maxLinesPerReview: 5000,
    },
  };
}
