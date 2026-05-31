// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const HttpsBaseUrl = "https://inference.eu.example/v1";
const HttpBaseUrl = "http://inference.eu.example/v1";

describe("SovriConfig OpenAI-compatible base URL boundary", () => {
  it("accepts HTTPS baseUrl unchanged at the config boundary", () => {
    // Given the Sovri config schema validates baseUrl with an HTTPS-only URL rule
    // And baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(HttpsBaseUrl));

    // Then validation succeeds
    // And the parsed baseUrl preserves the configured URL unchanged
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected HTTPS baseUrl to pass config validation");
    }
    expect(result.data.llm.baseUrl).toBe(HttpsBaseUrl);
  });

  it("rejects non-HTTPS baseUrl before compatible provider construction", () => {
    const createOpenAICompatibleProvider = vi.fn();

    // Given a Sovri config contains baseUrl "http://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(HttpBaseUrl));
    if (result.success) {
      createOpenAICompatibleProvider();
    }

    // Then validation fails
    // And createOpenAICompatibleProvider receives 0 calls
    // And no OpenAI-compatible provider is constructed with the non-HTTPS URL
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected non-HTTPS baseUrl to fail config validation");
    }
    expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.baseUrl")).toBe(true);
    expect(createOpenAICompatibleProvider).not.toHaveBeenCalled();
  });
});

function configWithBaseUrl(baseUrl: string): Record<string, unknown> {
  return {
    llm: {
      provider: "mistral",
      model: "mistral-large-latest",
      baseUrl,
      apiKeySecret: "MISTRAL_API_KEY",
    },
  };
}
