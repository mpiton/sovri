// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const BaseOpenAIConfig = {
  llm: {
    provider: "openai",
    model: "gpt-5-mini",
  },
} as const;

describe("R-05 apiKeySecret environment variable name contract", () => {
  it.each(["LLM_PROVIDER_VAR", "SOVRI_LLM_VAR_01", "_PRIVATE_LLM_VAR"] as const)(
    "accepts UPPER_SNAKE_CASE apiKeySecret name %s",
    (apiKeySecret) => {
      // Given llm.provider is "openai"
      // And llm.model is "gpt-5-mini"
      // And llm.baseUrl is omitted
      // And llm.apiKeySecret is "<apiKeySecret>"
      const result = SovriConfigSchema.safeParse(configWithApiKeySecret(apiKeySecret));

      // When SovriConfigSchema.safeParse() runs on the config
      // Then the result is success=true
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error("Expected env-var apiKeySecret name to pass config validation");
      }

      // And the parsed config has llm.apiKeySecret equal to "<apiKeySecret>"
      expect(result.data.llm.apiKeySecret).toBe(apiKeySecret);
    },
  );

  it.each(["openai-provider-var", "openaiProviderVar", "OPENAI PROVIDER VAR"] as const)(
    "rejects apiKeySecret value %s",
    (apiKeySecret) => {
      // Given llm.provider is "openai"
      // And llm.model is "gpt-5-mini"
      // And llm.baseUrl is omitted
      // And llm.apiKeySecret is "<apiKeySecret>"
      const result = SovriConfigSchema.safeParse(configWithApiKeySecret(apiKeySecret));

      // When SovriConfigSchema.safeParse() runs on the config
      // Then the result is success=false
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected invalid apiKeySecret value to fail config validation");
      }

      // And at least one issue has path "llm.apiKeySecret"
      // And no parsed config exposes the provided value
      expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.apiKeySecret")).toBe(
        true,
      );
    },
  );
});

function configWithApiKeySecret(apiKeySecret: string): Record<string, unknown> {
  return {
    llm: {
      ...BaseOpenAIConfig.llm,
      apiKeySecret,
    },
  };
}
