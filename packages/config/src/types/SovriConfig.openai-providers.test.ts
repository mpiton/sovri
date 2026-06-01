// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema, type Provider } from "./SovriConfig.js";

const providerExamples = [
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest",
    apiKeySecret: "ANTHROPIC_API_KEY",
    baseUrlLabel: "omitted",
  },
  {
    provider: "mistral",
    model: "mistral-large-2411",
    apiKeySecret: "MISTRAL_API_KEY",
    baseUrlLabel: "omitted",
  },
  {
    provider: "openai",
    model: "gpt-5-mini",
    apiKeySecret: "OPENAI_API_KEY",
    baseUrlLabel: "omitted",
  },
  {
    provider: "openai-compatible",
    model: "qwen2.5-coder-32b",
    apiKeySecret: "OPENAI_COMPATIBLE_API_KEY",
    baseUrl: "https://inference.eu.example/v1",
    baseUrlLabel: "https://inference.eu.example/v1",
  },
] satisfies readonly ProviderConfigExample[];

interface ProviderConfigExample {
  readonly provider: Provider;
  readonly model: string;
  readonly apiKeySecret: string;
  readonly baseUrl?: string;
  readonly baseUrlLabel: string;
}

describe("SovriConfigSchema OpenAI provider allow-list", () => {
  it.each(providerExamples)(
    "R-01 nominal — provider=$provider baseUrl=$baseUrlLabel parses through SovriConfigSchema",
    ({ provider, model, apiKeySecret, baseUrl }) => {
      // Given a .sovri.yml llm block with provider "<provider>"
      // And llm.model is "<model>"
      // And llm.apiKeySecret is "<apiKeySecret>"
      // And llm.baseUrl is "<baseUrl>"
      const result = SovriConfigSchema.safeParse(
        configForProvider({ provider, model, apiKeySecret, baseUrl }),
      );

      // When SovriConfigSchema.safeParse() runs on the config
      // Then the result is success=true
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error("Expected enabled provider config to parse");
      }

      // And the parsed config has llm.provider equal to "<provider>"
      expect(result.data.llm.provider).toBe(provider);
    },
  );

  it("R-01 violation — provider outside the enum is still rejected", () => {
    // Given a .sovri.yml llm block with provider "bedrock"
    // And llm.model is "claude-3-5-sonnet-latest"
    // And llm.apiKeySecret is "BEDROCK_API_KEY"
    const result = SovriConfigSchema.safeParse(
      configForProvider({
        provider: "bedrock",
        model: "claude-3-5-sonnet-latest",
        apiKeySecret: "BEDROCK_API_KEY",
      }),
    );

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=false
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected unsupported provider config to fail validation");
    }

    // And at least one issue has path "llm.provider"
    // And no parsed config is returned
    expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.provider")).toBe(true);
  });
});

function configForProvider(input: {
  readonly provider: string;
  readonly model: string;
  readonly apiKeySecret: string;
  readonly baseUrl?: string;
}): Record<string, unknown> {
  return {
    llm: {
      provider: input.provider,
      model: input.model,
      apiKeySecret: input.apiKeySecret,
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    },
  };
}
