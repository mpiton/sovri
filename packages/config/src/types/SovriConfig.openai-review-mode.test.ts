// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const BaseOpenAIConfig = {
  llm: {
    provider: "openai",
    model: "gpt-5-mini",
    apiKeySecret: "LLM_PROVIDER_VAR",
  },
} as const;

const ENABLED_REVIEW_MODE = "compliance" as const;
const LegacyReviewModes = ["full", "bugs-only", "strict", "minimal"] as const;

describe("R-07 OpenAI provider review mode contract", () => {
  it("accepts review.mode=compliance for OpenAI configs", () => {
    // Given llm.provider is "openai"
    // And review.mode is the single enabled review mode after MAT-78
    const result = SovriConfigSchema.safeParse(configWithReviewMode(ENABLED_REVIEW_MODE));

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected OpenAI config with the enabled review mode to parse");
    }

    // And the parsed provider and review mode are preserved
    expect(result.data.llm.provider).toBe("openai");
    expect(result.data.review.mode).toBe(ENABLED_REVIEW_MODE);
  });

  it.each(LegacyReviewModes)("rejects the legacy review.mode=%s for OpenAI configs", (mode) => {
    // Given llm.provider is "openai"
    // And review.mode is a legacy mode removed in the MAT-78 compliance pivot
    const result = SovriConfigSchema.safeParse(configWithReviewMode(mode));

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=false
    expect(result.success).toBe(false);
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
