// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const OpenAIConfig = {
  llm: {
    provider: "openai",
    model: "gpt-5-mini",
    apiKeySecret: "OPENAI_API_KEY",
  },
} as const;

const OpenAIBaseUrl = "https://gateway.eu.example/openai/v1";

describe("R-03 OpenAI baseUrl optionality", () => {
  it("parses openai without baseUrl", () => {
    // Given llm.provider is "openai"
    // And llm.model is "gpt-5-mini"
    // And llm.apiKeySecret is "OPENAI_API_KEY"
    // And llm.baseUrl is omitted
    const result = SovriConfigSchema.safeParse(OpenAIConfig);

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected openai config without baseUrl to parse");
    }

    // And the parsed config has llm.provider equal to "openai"
    // And the parsed config has no llm.baseUrl value
    expect(result.data.llm.provider).toBe("openai");
    expect(result.data.llm.baseUrl).toBeUndefined();
  });

  it("parses openai with an HTTPS baseUrl", () => {
    // Given llm.provider is "openai"
    // And llm.model is "gpt-5-mini"
    // And llm.apiKeySecret is "OPENAI_API_KEY"
    // And llm.baseUrl is "https://gateway.eu.example/openai/v1"
    const result = SovriConfigSchema.safeParse({
      llm: {
        ...OpenAIConfig.llm,
        baseUrl: OpenAIBaseUrl,
      },
    });

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected openai config with HTTPS baseUrl to parse");
    }

    // And the parsed config has llm.provider equal to "openai"
    // And the parsed config has llm.baseUrl equal to "https://gateway.eu.example/openai/v1"
    expect(result.data.llm.provider).toBe("openai");
    expect(result.data.llm.baseUrl).toBe(OpenAIBaseUrl);
  });

  it("does not let openai-compatible inherit openai baseUrl optionality", () => {
    // Given the same config changes llm.provider from "openai" to "openai-compatible"
    // And llm.baseUrl remains omitted
    const result = SovriConfigSchema.safeParse({
      llm: {
        ...OpenAIConfig.llm,
        provider: "openai-compatible",
        apiKeySecret: "OPENAI_COMPATIBLE_API_KEY",
      },
    });

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=false
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected openai-compatible config without baseUrl to fail");
    }

    // And exactly one issue has path "llm.baseUrl"
    const baseUrlIssues = result.error.issues.filter(
      (issue) => issue.path.join(".") === "llm.baseUrl",
    );
    expect(baseUrlIssues).toHaveLength(1);
  });
});
