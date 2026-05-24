// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  MAX_MISTRAL_MAX_TOKENS,
  MAX_MISTRAL_TIMEOUT_MS,
  MistralProvider,
  MistralProviderError,
} from "./MistralProvider.js";
import { fakeClient, TestApiKey } from "./MistralProvider.test-helpers.js";

describe("MistralProvider option validation", () => {
  it("rejects an empty API key", () => {
    expect(() => new MistralProvider({ apiKey: " ", client: fakeClient() })).toThrow(
      MistralProviderError,
    );
  });

  it("rejects an empty base URL", () => {
    expect(
      () => new MistralProvider({ apiKey: TestApiKey, baseUrl: " ", client: fakeClient() }),
    ).toThrow(MistralProviderError);
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_MISTRAL_MAX_TOKENS + 1])(
    "rejects invalid maxTokens: %s",
    (maxTokens) => {
      expect(
        () => new MistralProvider({ apiKey: TestApiKey, client: fakeClient(), maxTokens }),
      ).toThrow(MistralProviderError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, MAX_MISTRAL_TIMEOUT_MS + 1])(
    "rejects invalid timeoutMs: %s",
    (timeoutMs) => {
      expect(
        () => new MistralProvider({ apiKey: TestApiKey, client: fakeClient(), timeoutMs }),
      ).toThrow(MistralProviderError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid maxAttempts: %s", (maxAttempts) => {
    expect(
      () => new MistralProvider({ apiKey: TestApiKey, client: fakeClient(), maxAttempts }),
    ).toThrow(MistralProviderError);
  });
});
