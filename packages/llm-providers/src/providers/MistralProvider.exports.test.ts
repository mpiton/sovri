// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { MistralProvider, type LLMProvider } from "../index.js";
import { fakeClient, TestApiKey } from "./MistralProvider.test-helpers.js";

describe("MistralProvider package export", () => {
  it("exports a provider that satisfies LLMProvider", () => {
    // Given the package entrypoint is "packages/llm-providers/src/index.ts"
    // When a caller imports "MistralProvider" from "@sovri/llm-providers"
    const provider: LLMProvider = new MistralProvider({
      apiKey: TestApiKey,
      client: fakeClient(),
    });

    // Then the import resolves
    // And the imported symbol can construct an LLMProvider
    expect(provider.name).toBe("mistral");
    expect(provider.generateStructured).toEqual(expect.any(Function));
  });
});
