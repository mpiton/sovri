// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  CompatibleProviderFixture,
  findForbiddenCompatibleNetworkPatterns,
  ForbiddenCompatibleNetworkPatterns,
  ForbiddenEnvironmentLookupSamples,
  UnmockedCompatibleSdkConstructionLabel,
} from "./OpenAICompatibleProvider.no-network-guard.js";

describe("OpenAI-compatible no-network source guard", () => {
  it.each(ForbiddenCompatibleNetworkPatterns)(
    "rejects forbidden OpenAI-compatible provider network pattern $label",
    ({ label, sample }) => {
      const source = `createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });\n${sample}`;

      const violations = findForbiddenCompatibleNetworkPatterns(source);

      expect(violations).toContain(label);
    },
  );

  it.each(ForbiddenEnvironmentLookupSamples)(
    "rejects API-key environment lookup variant %s",
    (sample, label) => {
      const violations = findForbiddenCompatibleNetworkPatterns(sample);

      expect(violations).toContain(label);
    },
  );

  it("rejects direct compatible SDK construction without an injected client", () => {
    const source = `const provider = createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });`;

    const violations = findForbiddenCompatibleNetworkPatterns(source);

    expect(violations).toContain(UnmockedCompatibleSdkConstructionLabel);
  });

  it("allows compatible provider construction with a fake client or mocked OpenAI SDK", () => {
    const withFakeClient = `createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}", client: fakeOpenAIClient() });`;
    const withMockedSdk = `vi.doMock("openai", () => mockOpenAIModule([]));\ncreateOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });`;

    expect(findForbiddenCompatibleNetworkPatterns(withFakeClient)).not.toContain(
      UnmockedCompatibleSdkConstructionLabel,
    );
    expect(findForbiddenCompatibleNetworkPatterns(withMockedSdk)).not.toContain(
      UnmockedCompatibleSdkConstructionLabel,
    );
  });

  it("rejects unmocked compatible SDK construction in a later test block", () => {
    const source = `it("mocked", () => {
  vi.doMock("openai", () => mockOpenAIModule([]));
  createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });
});

it("unmocked", () => {
  createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });
});`;

    const violations = findForbiddenCompatibleNetworkPatterns(source);

    expect(violations).toContain(UnmockedCompatibleSdkConstructionLabel);
  });

  it("rejects unmocked compatible SDK construction after a Vitest test alias block", () => {
    const source = `test("mocked", () => {
  vi.doMock("openai", () => mockOpenAIModule([]));
  createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });
});

test("unmocked", () => {
  createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });
});`;

    const violations = findForbiddenCompatibleNetworkPatterns(source);

    expect(violations).toContain(UnmockedCompatibleSdkConstructionLabel);
  });

  it("rejects non-inline compatible SDK options without an injected client", () => {
    const source = `it("unmocked variable options", () => {
  const options = { apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" };
  createOpenAICompatibleProvider(options);
});`;

    const violations = findForbiddenCompatibleNetworkPatterns(source);

    expect(violations).toContain(UnmockedCompatibleSdkConstructionLabel);
  });

  it("rejects nested compatible SDK client options", () => {
    const source = `it("nested client", () => {
  const options = {
    apiKey: "${CompatibleProviderFixture.apiKey}",
    baseUrl: "${CompatibleProviderFixture.baseUrl}",
    metadata: { client: fakeOpenAIClient() },
  };
  createOpenAICompatibleProvider(options);
});`;

    const violations = findForbiddenCompatibleNetworkPatterns(source);

    expect(violations).toContain(UnmockedCompatibleSdkConstructionLabel);
  });

  it("allows non-inline compatible SDK options with a fake client", () => {
    const withVariableOptions = `it("fake client options", () => {
  const options = { apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}", client: fakeOpenAIClient() };
  createOpenAICompatibleProvider(options);
});`;
    const withHelperOptions = `it("helper options", () => {
  createOpenAICompatibleProvider(providerOptions("${CompatibleProviderFixture.baseUrl}"));
});

function providerOptions(baseUrl: string): OpenAICompatibleProviderOptions {
  return { apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl, client: fakeOpenAIClient() };
}`;

    expect(findForbiddenCompatibleNetworkPatterns(withVariableOptions)).not.toContain(
      UnmockedCompatibleSdkConstructionLabel,
    );
    expect(findForbiddenCompatibleNetworkPatterns(withHelperOptions)).not.toContain(
      UnmockedCompatibleSdkConstructionLabel,
    );
  });
});
