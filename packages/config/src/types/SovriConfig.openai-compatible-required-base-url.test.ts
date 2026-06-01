// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const OpenAICompatibleConfig = {
  llm: {
    provider: "openai-compatible",
    model: "qwen2.5-coder-32b",
    apiKeySecret: "OPENAI_COMPATIBLE_API_KEY",
  },
} as const;

const CompatibleBaseUrl = "https://inference.eu.example/v1";
const SlashDelimitedCompatibleModel = "Qwen/Qwen2.5-Coder-32B-Instruct";
const MissingBaseUrlMessage = "llm.baseUrl is required when llm.provider is 'openai-compatible'.";

describe("R-02 OpenAI-compatible baseUrl requirement", () => {
  it("parses openai-compatible when baseUrl is present", () => {
    // Given llm.provider is "openai-compatible"
    // And llm.model is "qwen2.5-coder-32b"
    // And llm.apiKeySecret is "OPENAI_COMPATIBLE_API_KEY"
    // And llm.baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse({
      llm: {
        ...OpenAICompatibleConfig.llm,
        baseUrl: CompatibleBaseUrl,
      },
    });

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected openai-compatible config with baseUrl to parse");
    }

    // And the parsed config has llm.provider equal to "openai-compatible"
    // And the parsed config has llm.baseUrl equal to "https://inference.eu.example/v1"
    expect(result.data.llm.provider).toBe("openai-compatible");
    expect(result.data.llm.baseUrl).toBe(CompatibleBaseUrl);
  });

  it("rejects openai-compatible without baseUrl on llm.baseUrl", () => {
    // Given llm.provider is "openai-compatible"
    // And llm.model is "qwen2.5-coder-32b"
    // And llm.apiKeySecret is "OPENAI_COMPATIBLE_API_KEY"
    // And llm.baseUrl is omitted
    const result = SovriConfigSchema.safeParse(OpenAICompatibleConfig);

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=false
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected openai-compatible config without baseUrl to fail");
    }

    const baseUrlIssues = result.error.issues.filter(
      (issue) => issue.path.join(".") === "llm.baseUrl",
    );
    const providerIssues = result.error.issues.filter(
      (issue) => issue.path.join(".") === "llm.provider",
    );

    // And exactly one issue has path "llm.baseUrl"
    // And that issue.message equals "llm.baseUrl is required when llm.provider is 'openai-compatible'."
    // And no issue has path "llm.provider"
    expect(baseUrlIssues).toHaveLength(1);
    expect(baseUrlIssues[0]?.message).toBe(MissingBaseUrlMessage);
    expect(providerIssues).toHaveLength(0);
  });

  it("accepts slash-delimited model identifiers for OpenAI-compatible endpoints", () => {
    // Given llm.provider is "openai-compatible"
    // And llm.model uses a Hugging Face-style slash-delimited identifier
    // And llm.baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse({
      llm: {
        ...OpenAICompatibleConfig.llm,
        model: SlashDelimitedCompatibleModel,
        baseUrl: CompatibleBaseUrl,
      },
    });

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected slash-delimited OpenAI-compatible model to parse");
    }

    // And the parsed config preserves the slash-delimited model identifier
    expect(result.data.llm.model).toBe(SlashDelimitedCompatibleModel);
  });
});
