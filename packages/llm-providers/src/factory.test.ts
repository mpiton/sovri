// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  createProviderFromConfig,
  MissingApiKeyError,
  UnsupportedProviderError,
  type LLMProvider,
} from "./index.js";

describe("createProviderFromConfig", () => {
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

      // And the returned provider name equals "<provider>"
      expect(createdProvider.name).toBe(provider);
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
