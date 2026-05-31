// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it, vi } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const HttpsBaseUrl = "https://inference.eu.example/v1";
const HttpBaseUrl = "http://inference.eu.example/v1";
const EnabledProvider = "mistral";
const CompatibleProvider = "openai-compatible";

describe("SovriConfig OpenAI-compatible base URL boundary", () => {
  it("accepts HTTPS baseUrl unchanged for an enabled provider at the config boundary", () => {
    // Given the Sovri config schema validates baseUrl with an HTTPS-only URL rule
    // And baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(EnabledProvider, HttpsBaseUrl));

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
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(EnabledProvider, HttpBaseUrl));
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

  it("keeps openai-compatible config gated separately from HTTPS baseUrl validation", () => {
    const createOpenAICompatibleProvider = vi.fn();

    // Given a Sovri config selects provider "openai-compatible"
    // And baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(CompatibleProvider, HttpsBaseUrl));
    if (result.success) {
      createOpenAICompatibleProvider();
    }

    // Then validation fails on the provider gate in this release
    // And createOpenAICompatibleProvider receives 0 calls
    // And the valid HTTPS baseUrl is not the failing issue
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected openai-compatible provider to remain gated in this release");
    }
    expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.provider")).toBe(true);
    expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.baseUrl")).toBe(false);
    expect(createOpenAICompatibleProvider).not.toHaveBeenCalled();
  });
});

function configWithBaseUrl(provider: string, baseUrl: string): Record<string, unknown> {
  return {
    llm: {
      provider,
      model: "mistral-large-latest",
      baseUrl,
      apiKeySecret: "MISTRAL_API_KEY",
    },
  };
}
