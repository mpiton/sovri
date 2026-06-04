// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const CompatibleProviderFixture = {
  apiKey: "test-openai-compatible-key",
  baseUrl: "https://compatible.test/v1",
  publicOpenAIHost: ["api", "openai", "com"].join("."),
};

interface ForbiddenCompatibleNetworkPattern {
  readonly label: string;
  readonly matches: (source: string) => boolean;
  readonly sample: string;
}

export const ForbiddenCompatibleNetworkPatterns = [
  {
    label: `https://${CompatibleProviderFixture.publicOpenAIHost}`,
    matches: (source) => source.toLowerCase().includes(CompatibleProviderFixture.publicOpenAIHost),
    sample: `https://${CompatibleProviderFixture.publicOpenAIHost}`,
  },
  {
    label: "process.env.OPENAI_API_KEY",
    matches: (source) => /\bOPENAI_API_KEY\b/.test(source),
    sample: "process.env.OPENAI_API_KEY",
  },
  {
    label: "process.env.OPENAI_COMPATIBLE_API_KEY",
    matches: (source) => /\bOPENAI_COMPATIBLE_API_KEY\b/.test(source),
    sample: "process.env.OPENAI_COMPATIBLE_API_KEY",
  },
] satisfies readonly ForbiddenCompatibleNetworkPattern[];

export const ForbiddenEnvironmentLookupSamples = [
  ['process.env["OPENAI_API_KEY"]', "process.env.OPENAI_API_KEY"],
  ["const { OPENAI_API_KEY } = process.env;", "process.env.OPENAI_API_KEY"],
  ['process.env["OPENAI_COMPATIBLE_API_KEY"]', "process.env.OPENAI_COMPATIBLE_API_KEY"],
  ["const { OPENAI_COMPATIBLE_API_KEY } = process.env;", "process.env.OPENAI_COMPATIBLE_API_KEY"],
] satisfies ReadonlyArray<readonly [string, string]>;

export const UnmockedCompatibleSdkConstructionLabel =
  "createOpenAICompatibleProvider without client or mocked OpenAI SDK";
