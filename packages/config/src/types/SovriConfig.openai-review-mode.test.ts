// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const BaseOpenAIConfig = {
  llm: {
    provider: "openai",
    model: "gpt-5-mini",
    apiKeySecret: "LLM_PROVIDER_VAR",
  },
} as const;

const EnabledReviewModes = ["full", "bugs-only", "strict", "minimal"] as const;

describe("R-07 OpenAI provider review mode contract", () => {
  it.each(EnabledReviewModes)("accepts review.mode=%s for OpenAI configs", (mode) => {
    // Given llm.provider is "openai"
    // And review.mode is an enabled review mode
    const result = SovriConfigSchema.safeParse(configWithReviewMode(mode));

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected OpenAI config with enabled review mode to parse");
    }

    // And the parsed provider and review mode are preserved
    expect(result.data.llm.provider).toBe("openai");
    expect(result.data.review.mode).toBe(mode);
  });
});

function configWithReviewMode(mode: string): Record<string, unknown> {
  return {
    ...BaseOpenAIConfig,
    review: {
      mode,
    },
  };
}
