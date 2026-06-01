// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { ProviderSchema, type Provider } from "./SovriConfig.js";

const ExpectedProviders = [
  "anthropic",
  "mistral",
  "openai",
  "openai-compatible",
] as const satisfies readonly Provider[];

describe("R-06 ProviderSchema enum contract", () => {
  it("exposes exactly the v0.5 provider values", () => {
    // Given ProviderSchema is the source of truth for llm.provider
    // When its declared options are read
    // Then the options are exactly the accepted v0.5 provider values
    expect(ProviderSchema.options).toEqual(ExpectedProviders);
  });

  it.each(ExpectedProviders)("parses provider value %s", (provider) => {
    // Given a declared provider value
    const result = ProviderSchema.safeParse(provider);

    // When ProviderSchema validates the value
    // Then parsing succeeds and preserves the exact provider string
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected declared provider value to parse");
    }

    expect(result.data).toBe(provider);
  });

  it.each(["bedrock", "azure-openai", "cohere"] as const)(
    "rejects unsupported provider value %s",
    (provider) => {
      // Given a provider value outside the declared enum
      const result = ProviderSchema.safeParse(provider);

      // When ProviderSchema validates the value
      // Then parsing fails
      expect(result.success).toBe(false);
    },
  );

  it("keeps the Provider union exhaustive over the declared providers", () => {
    // Given each declared provider value
    // When the Provider union is consumed by a switch
    // Then all declared providers are handled explicitly
    const labels = ExpectedProviders.map(providerContractLabel);

    expect(labels).toEqual(["anthropic", "mistral", "openai", "openai-compatible"]);
  });
});

function providerContractLabel(provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "mistral":
      return "mistral";
    case "openai":
      return "openai";
    case "openai-compatible":
      return "openai-compatible";
    default:
      return assertNever(provider);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled provider value: ${String(value)}`);
}
