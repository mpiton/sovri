// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

const BaseCompatibleLlm = {
  provider: "openai-compatible",
  model: "qwen2.5-coder-32b",
  apiKeySecret: "OPENAI_COMPATIBLE_API_KEY",
} as const;

const CompatibleBaseUrl = "https://inference.eu.example/v1";
const NonHttpsBaseUrl = "http://inference.eu.example/v1";

describe("R-04 baseUrl constraints", () => {
  it("accepts a bounded HTTPS baseUrl unchanged", () => {
    // Given llm.provider is "openai-compatible"
    // And llm.model is "qwen2.5-coder-32b"
    // And llm.apiKeySecret is "OPENAI_COMPATIBLE_API_KEY"
    // And llm.baseUrl is "https://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(CompatibleBaseUrl));

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=true
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected HTTPS baseUrl to pass config validation");
    }

    // And the parsed config has llm.baseUrl equal to "https://inference.eu.example/v1"
    expect(result.data.llm.baseUrl).toBe(CompatibleBaseUrl);
  });

  it("rejects non-HTTPS baseUrl", () => {
    // Given llm.baseUrl is "http://inference.eu.example/v1"
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(NonHttpsBaseUrl));

    // When SovriConfigSchema.safeParse() runs on the config
    // Then the result is success=false
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected non-HTTPS baseUrl to fail config validation");
    }

    // And at least one issue has path "llm.baseUrl"
    // And no parsed config is returned
    expect(result.error.issues.some((issue) => issue.path.join(".") === "llm.baseUrl")).toBe(true);
  });

  it.each([
    [2048, true, "maximum accepted unchanged"],
    [2049, false, "maximum length exceeded"],
  ] as const)("keeps baseUrl length boundary at %i characters: %s", (length, success, _outcome) => {
    // Given llm.baseUrl is an HTTPS URL with total length <length>
    const baseUrl = httpsUrlWithTotalLength(length);

    // When SovriConfigSchema.safeParse() runs on the config
    const result = SovriConfigSchema.safeParse(configWithBaseUrl(baseUrl));

    // Then the result is success=<success>
    // And the outcome is "<outcome>"
    expect(baseUrl).toHaveLength(length);
    expect(result.success).toBe(success);
    if (result.success) {
      expect(result.data.llm.baseUrl).toBe(baseUrl);
    }
  });
});

function configWithBaseUrl(baseUrl: string): Record<string, unknown> {
  return {
    llm: {
      ...BaseCompatibleLlm,
      baseUrl,
    },
  };
}

function httpsUrlWithTotalLength(totalLength: number): string {
  const prefix = "https://inference.eu.example/";
  return prefix + "a".repeat(totalLength - prefix.length);
}
