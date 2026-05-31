// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

/**
 * Guard rail tests that keep the OpenAI-compatible provider suite on injected clients and fixture
 * credentials.
 */
import { readdir, readFile } from "node:fs/promises";

import { z } from "@sovri/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMProvider, StructuredGeneration } from "../types/LLMProvider.js";

const ProviderTestDiscovery = {
  directory: new URL(".", import.meta.url),
  selfFileName: "OpenAICompatibleProvider.no-network.test.ts",
  additionalFileNames: ["OpenAIProvider.compatible.exports.test.ts"],
};

const CompatibleProviderFixture = {
  apiKey: "test-openai-compatible-key",
  baseUrl: "https://compatible.test/v1",
  publicOpenAIHost: ["api", "openai", "com"].join("."),
};

const ReviewParams = {
  systemPrompt: "Review code safely.",
  userPrompt: "Diff contents",
  schema: z.strictObject({ summary: z.string() }),
};

type ReviewData = z.infer<typeof ReviewParams.schema>;

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

interface OpenAICompatibleProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly client?: FakeOpenAIChatClient;
}

interface OpenAICompatibleProviderExports {
  readonly createOpenAICompatibleProvider: (
    options: OpenAICompatibleProviderOptions,
  ) => LLMProvider;
  readonly OpenAIProviderError: ErrorConstructor;
}

interface ForbiddenCompatibleNetworkPattern {
  readonly label: string;
  readonly matches: (source: string) => boolean;
  readonly sample: string;
}

const ForbiddenCompatibleNetworkPatterns = [
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

const ForbiddenEnvironmentLookupSamples = [
  ['process.env["OPENAI_API_KEY"]', "process.env.OPENAI_API_KEY"],
  ["const { OPENAI_API_KEY } = process.env;", "process.env.OPENAI_API_KEY"],
  ['process.env["OPENAI_COMPATIBLE_API_KEY"]', "process.env.OPENAI_COMPATIBLE_API_KEY"],
  ["const { OPENAI_COMPATIBLE_API_KEY } = process.env;", "process.env.OPENAI_COMPATIBLE_API_KEY"],
] satisfies ReadonlyArray<readonly [string, string]>;

const UnmockedCompatibleSdkConstructionLabel =
  "createOpenAICompatibleProvider without client or mocked OpenAI SDK";
const OpenAIMockPattern = /vi\.doMock\(\s*["']openai["']/;
const TestBlockPattern = /\b(?:it|test)(?:\.each)?\s*\(/g;
const DirectCompatibleProviderConstructionPattern =
  /\bcreateOpenAICompatibleProvider\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
const NonInlineCompatibleProviderConstructionPattern =
  /\bcreateOpenAICompatibleProvider\s*\(\s*([A-Za-z_$][\w$]*(?:\s*\([^)]*\))?)\s*\)/g;
const IdentifierPattern = /^[A-Za-z_$][\w$]*$/;
const HelperCallPattern = /^([A-Za-z_$][\w$]*)\s*\(/;
const TopLevelClientOptionPattern = /\bclient\s*:/g;
const HelperObjectLiteralPattern = /(?:return|=)\s*\{([\s\S]*?)\}/g;

afterEach(() => {
  vi.doUnmock("openai");
  vi.resetModules();
});

describe("OpenAI-compatible no-network test guard", () => {
  it("keeps compatible provider behavior tests on injected fake clients", async () => {
    const calls: unknown[] = [];
    const { createOpenAICompatibleProvider } = await openAICompatibleProviderExports();

    // Given the compatible provider tests are colocated under "packages/llm-providers/src/providers"
    // And the test API key is "test-openai-compatible-key"
    // And the test baseUrl is "https://compatible.test/v1"
    // Given the fake compatible client returns content "{\"summary\":\"Reviewed\"}"
    // And the fake compatible client reports 123 prompt tokens and 45 completion tokens
    const provider = createOpenAICompatibleProvider({
      apiKey: CompatibleProviderFixture.apiKey,
      baseUrl: CompatibleProviderFixture.baseUrl,
      client: fakeOpenAIClient(calls),
    });

    // When the compatible provider tests call generateStructuredWithUsage
    const result = await generateStructuredWithUsage<ReviewData>(provider);

    // Then exactly 1 fake client call is observed
    // And no real OpenAI SDK network request is attempted
    // And no real API key environment variable is read
    expect(result.data).toEqual({ summary: "Reviewed" });
    expect(result.tokenUsage).toEqual({ prompt: 123, completion: 45 });
    expect(calls).toHaveLength(1);
    expect(committedSourceViolations(await readOpenAICompatibleProviderTestSources())).toEqual([]);
  });

  it.each(ForbiddenCompatibleNetworkPatterns)(
    "rejects forbidden OpenAI-compatible provider network pattern $label",
    ({ label, sample }) => {
      // Given a compatible provider test file contains "<forbidden_pattern>"
      const source = `createOpenAICompatibleProvider({ apiKey: "${CompatibleProviderFixture.apiKey}", baseUrl: "${CompatibleProviderFixture.baseUrl}" });\n${sample}`;

      // When the no-network test guard runs
      const violations = findForbiddenCompatibleNetworkPatterns(source);

      // Then the guard fails
      // And the failure identifies "<forbidden_pattern>" as incompatible with provider unit tests
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

  it("keeps committed compatible provider tests free of real network dependencies", async () => {
    const sources = await readOpenAICompatibleProviderTestSources();

    expect(committedSourceViolations(sources)).toEqual([]);
  });

  it("includes the compatible export acceptance test in committed no-network checks", async () => {
    const sources = await readOpenAICompatibleProviderTestSources();

    expect(sources.map((source) => source.fileName)).toContain(
      "OpenAIProvider.compatible.exports.test.ts",
    );
  });

  it("rejects missing baseUrl before fake client or SDK construction", async () => {
    const calls: unknown[] = [];
    const sdkConstructorOptions: unknown[] = [];
    vi.doMock("openai", () => mockOpenAIModule(sdkConstructorOptions));
    const { createOpenAICompatibleProvider, OpenAIProviderError } =
      await openAICompatibleProviderExports();

    // Given baseUrl is missing
    // When the compatible provider is constructed without an injected client
    const error = captureError(() =>
      createOpenAICompatibleProvider({
        apiKey: CompatibleProviderFixture.apiKey,
        client: fakeOpenAIClient(calls),
      }),
    );

    // Then OpenAIProviderError is thrown
    // And the fake compatible client receives 0 calls
    // And the OpenAI SDK constructor receives 0 calls
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(calls).toEqual([]);
    expect(sdkConstructorOptions).toEqual([]);
  });
});

async function openAICompatibleProviderExports(): Promise<OpenAICompatibleProviderExports> {
  const module = await import("../index.js");
  const createOpenAICompatibleProvider = Reflect.get(module, "createOpenAICompatibleProvider");
  const OpenAIProviderError = Reflect.get(module, "OpenAIProviderError");

  if (typeof createOpenAICompatibleProvider !== "function") {
    throw new Error("createOpenAICompatibleProvider export is missing");
  }
  if (!isErrorConstructor(OpenAIProviderError)) {
    throw new Error("OpenAIProviderError export is missing");
  }

  return { createOpenAICompatibleProvider, OpenAIProviderError };
}

function fakeOpenAIClient(calls: unknown[]): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          calls.push(request);
          return {
            choices: [{ message: { content: '{"summary":"Reviewed"}' } }],
            usage: {
              prompt_tokens: 123,
              completion_tokens: 45,
            },
          };
        },
      },
    },
  };
}

function mockOpenAIModule(sdkConstructorOptions: unknown[]): Record<string, unknown> {
  class MockOpenAI {
    readonly chat = {
      completions: {
        create: async () => {
          throw new Error("Mock OpenAI-compatible client should not receive requests");
        },
      },
    };

    constructor(options: unknown) {
      sdkConstructorOptions.push(options);
    }
  }

  class MockAPIError extends Error {}
  class MockAPIConnectionError extends MockAPIError {}
  class MockAPIConnectionTimeoutError extends MockAPIError {}
  class MockAuthenticationError extends MockAPIError {}
  class MockPermissionDeniedError extends MockAPIError {}

  return {
    default: MockOpenAI,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
    APIError: MockAPIError,
    AuthenticationError: MockAuthenticationError,
    PermissionDeniedError: MockPermissionDeniedError,
  };
}

async function readOpenAICompatibleProviderTestSources(): Promise<ProviderTestSource[]> {
  const fileNames = (await readdir(ProviderTestDiscovery.directory))
    .filter(
      (fileName) =>
        isDiscoveredCompatibleProviderTestFile(fileName) &&
        fileName.endsWith(".test.ts") &&
        fileName !== ProviderTestDiscovery.selfFileName,
    )
    .toSorted();

  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      source: await readFile(new URL(fileName, ProviderTestDiscovery.directory), "utf8"),
    })),
  );
}

function isDiscoveredCompatibleProviderTestFile(fileName: string): boolean {
  return (
    fileName.startsWith("OpenAICompatibleProvider.") ||
    ProviderTestDiscovery.additionalFileNames.includes(fileName)
  );
}

interface ProviderTestSource {
  readonly fileName: string;
  readonly source: string;
}

function committedSourceViolations(sources: ReadonlyArray<ProviderTestSource>): string[] {
  return sources.flatMap((source) =>
    findForbiddenCompatibleNetworkPatterns(source.source).map(
      (forbiddenPattern) => `${source.fileName}: ${forbiddenPattern}`,
    ),
  );
}

function findForbiddenCompatibleNetworkPatterns(source: string): string[] {
  const forbiddenPatterns = ForbiddenCompatibleNetworkPatterns.filter(({ matches }) =>
    matches(source),
  ).map(({ label }) => label);

  if (hasUnmockedCompatibleProviderConstruction(source)) {
    return [...forbiddenPatterns, UnmockedCompatibleSdkConstructionLabel];
  }

  return forbiddenPatterns;
}

function generateStructuredWithUsage<T>(provider: LLMProvider): Promise<StructuredGeneration<T>> {
  if (provider.generateStructuredWithUsage === undefined) {
    throw new Error("generateStructuredWithUsage is missing");
  }

  return provider.generateStructuredWithUsage<T>(ReviewParams);
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error("Expected constructor to throw");
}

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

function hasUnmockedCompatibleProviderConstruction(source: string): boolean {
  for (const match of source.matchAll(DirectCompatibleProviderConstructionPattern)) {
    const options = match[1];
    if (
      options !== undefined &&
      !hasTopLevelClientOption(options) &&
      !hasOpenAIMockInCurrentTestBlock(source, match.index)
    ) {
      return true;
    }
  }

  for (const match of source.matchAll(NonInlineCompatibleProviderConstructionPattern)) {
    const optionsExpression = match[1];
    if (
      optionsExpression !== undefined &&
      !hasOpenAIMockInCurrentTestBlock(source, match.index) &&
      !nonInlineOptionsIncludeClient(source, optionsExpression, match.index)
    ) {
      return true;
    }
  }

  return false;
}

function nonInlineOptionsIncludeClient(
  source: string,
  optionsExpression: string,
  constructionIndex: number,
): boolean {
  const expression = optionsExpression.trim();
  if (IdentifierPattern.test(expression)) {
    return assignedOptionsIncludeClient(source, expression, constructionIndex);
  }

  const helperCall = HelperCallPattern.exec(expression);
  const helperName = helperCall?.[1];
  if (helperName === undefined) {
    return false;
  }

  return helperOptionsIncludeClient(source, helperName);
}

function assignedOptionsIncludeClient(
  source: string,
  variableName: string,
  constructionIndex: number,
): boolean {
  const assignmentPattern = new RegExp(
    `\\b(?:const|let)\\s+${escapeRegExp(variableName)}\\s*=\\s*\\{([\\s\\S]*?)\\}`,
    "g",
  );
  const sourceBeforeConstruction = source.slice(
    currentTestBlockStart(source, constructionIndex),
    constructionIndex,
  );
  let optionsSource: string | undefined;

  for (const match of sourceBeforeConstruction.matchAll(assignmentPattern)) {
    optionsSource = match[1];
  }

  return optionsSource !== undefined && hasTopLevelClientOption(optionsSource);
}

function helperOptionsIncludeClient(source: string, helperName: string): boolean {
  const functionStart = source.indexOf(`function ${helperName}`);
  if (functionStart === -1) {
    return false;
  }

  const nextFunction = source.indexOf("\nfunction ", functionStart + 1);
  const functionSource = source.slice(
    functionStart,
    nextFunction === -1 ? source.length : nextFunction,
  );
  return Array.from(functionSource.matchAll(HelperObjectLiteralPattern)).some((match) => {
    const optionsSource = match[1];
    return optionsSource !== undefined && hasTopLevelClientOption(optionsSource);
  });
}

function hasOpenAIMockInCurrentTestBlock(source: string, constructionIndex: number): boolean {
  const testBlockStart = currentTestBlockStart(source, constructionIndex);
  return OpenAIMockPattern.test(source.slice(testBlockStart, constructionIndex));
}

function currentTestBlockStart(source: string, constructionIndex: number): number {
  let testBlockStart = 0;
  const sourceBeforeConstruction = source.slice(0, constructionIndex);

  for (const match of sourceBeforeConstruction.matchAll(TestBlockPattern)) {
    testBlockStart = match.index;
  }

  return testBlockStart;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTopLevelClientOption(optionsSource: string): boolean {
  for (const match of optionsSource.matchAll(TopLevelClientOptionPattern)) {
    if (objectLiteralDepthAt(optionsSource, match.index) === 0) {
      return true;
    }
  }

  return false;
}

function objectLiteralDepthAt(source: string, targetIndex: number): number {
  let depth = 0;

  for (let index = 0; index < targetIndex; index += 1) {
    const char = source.at(index);
    if (char === "{") {
      depth += 1;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
    }
  }

  return depth;
}
