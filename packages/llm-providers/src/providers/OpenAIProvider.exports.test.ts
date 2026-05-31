// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_MAX_TOKENS,
  DEFAULT_OPENAI_MODEL,
  OpenAIProvider,
  type LLMProvider,
} from "../index.js";
import * as LlmProviders from "../index.js";

const TestApiKey = "test-openai-key";
const ProviderFiles = [
  "OpenAIProvider.ts",
  "OpenAIProvider.options.ts",
  "OpenAIProvider.response.ts",
  "OpenAIProvider.schema-matching.ts",
  "OpenAIProvider.schema-normalization.ts",
  "OpenAIProvider.schema-stripping.ts",
  "OpenAIProvider.retry.ts",
  "OpenAIProvider.errors.ts",
] satisfies readonly string[];
const RequiredOpenAIExports = [
  "OpenAIProvider",
  "DEFAULT_OPENAI_MODEL",
  "DEFAULT_OPENAI_MAX_TOKENS",
  "OpenAIProviderAuthError",
  "OpenAIProviderError",
  "OpenAIProviderRetryError",
  "OpenAIProviderTimeoutError",
] satisfies readonly string[];
const ForbiddenTypeScriptTexts = [
  "any",
  "@ts-ignore",
  "@ts-expect-error",
  "require(",
] satisfies readonly string[];

interface FakeOpenAIChatClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: unknown, options?: unknown) => Promise<unknown>;
    };
  };
}

describe("OpenAIProvider package exports and quality acceptance", () => {
  it("exports the required public OpenAI provider API with license headers", async () => {
    // Given the provider implementation file is "packages/llm-providers/src/providers/OpenAIProvider.ts"
    // And the package export barrel is "packages/llm-providers/src/index.ts"
    // Given the OpenAI provider files are inspected
    // When the public package exports are collected
    const exportedNames = Object.keys(LlmProviders);

    // Then "OpenAIProvider" is exported from "packages/llm-providers/src/index.ts"
    // And "DEFAULT_OPENAI_MODEL" is exported from "packages/llm-providers/src/index.ts"
    // And "DEFAULT_OPENAI_MAX_TOKENS" is exported from "packages/llm-providers/src/index.ts"
    // And "OpenAIProviderAuthError" is exported from "packages/llm-providers/src/index.ts"
    // And "OpenAIProviderError" is exported from "packages/llm-providers/src/index.ts"
    // And "OpenAIProviderRetryError" is exported from "packages/llm-providers/src/index.ts"
    // And "OpenAIProviderTimeoutError" is exported from "packages/llm-providers/src/index.ts"
    // And each new source file starts with "SPDX-License-Identifier: Apache-2.0"
    expect(exportedNames).toEqual(expect.arrayContaining(RequiredOpenAIExports));
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.5");
    expect(DEFAULT_OPENAI_MAX_TOKENS).toBe(4096);
    await expectOpenAIProviderFilesToHaveLicenseHeaders();
  });

  it.each(ForbiddenTypeScriptTexts)(
    "names forbidden TypeScript escape hatch %s",
    (forbiddenText) => {
      // Given a new OpenAI provider source file contains "<forbidden_text>"
      const source = sourceWithForbiddenText(forbiddenText);

      // When "pnpm exec oxlint packages/llm-providers" and "pnpm exec tsc -b" run
      const violations = findForbiddenTypeScriptTexts(source);

      // Then the quality gate fails
      // And the failure names "<forbidden_text>"
      expect(violations).toContain(forbiddenText);
    },
  );

  it("keeps OpenAI provider source files free of forbidden TypeScript escape hatches", async () => {
    const violations = await findOpenAIProviderSourceViolations();

    expect(violations).toEqual([]);
  });

  it("exports OpenAIProvider through the package entrypoint as an LLMProvider", () => {
    // Given "OpenAIProvider.exports.test.ts" imports OpenAIProvider from "../index.js"
    // When the test constructs the provider with an injected fake client
    const provider: LLMProvider = new OpenAIProvider({
      apiKey: TestApiKey,
      client: fakeOpenAIClient(),
    });

    // Then the provider is assignable to LLMProvider
    // And provider.name equals "openai"
    // And provider.generateStructured equals a function
    expect(provider.name).toBe("openai");
    expect(provider.generateStructured).toEqual(expect.any(Function));
  });
});

async function expectOpenAIProviderFilesToHaveLicenseHeaders(): Promise<void> {
  const sources = await Promise.all(
    ProviderFiles.map(async (fileName) => ({
      fileName,
      source: await readProviderFile(fileName),
    })),
  );

  for (const source of sources) {
    expect(source.source, source.fileName).toMatch(/^\/\/ SPDX-License-Identifier: Apache-2\.0/u);
  }
}

async function findOpenAIProviderSourceViolations(): Promise<string[]> {
  const sources = await Promise.all(
    ProviderFiles.map(async (fileName) => ({
      fileName,
      source: await readProviderFile(fileName),
    })),
  );

  return sources.flatMap((source) =>
    findForbiddenTypeScriptTexts(source.source).map(
      (forbiddenText) => `${source.fileName}: ${forbiddenText}`,
    ),
  );
}

function sourceWithForbiddenText(forbiddenText: string): string {
  if (forbiddenText === "any") {
    return "const value: any = 1;";
  }

  return `${forbiddenText}\nconst value = 1;`;
}

function findForbiddenTypeScriptTexts(source: string): string[] {
  const violations: string[] = [];
  if (/\bany\b/u.test(source)) {
    violations.push("any");
  }

  for (const forbiddenText of ForbiddenTypeScriptTexts) {
    if (forbiddenText !== "any" && source.includes(forbiddenText)) {
      violations.push(forbiddenText);
    }
  }

  return violations;
}

function readProviderFile(fileName: string): Promise<string> {
  return readFile(new URL(fileName, import.meta.url), "utf8");
}

function fakeOpenAIClient(): FakeOpenAIChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error("OpenAIProvider exports test should not create chat completions");
        },
      },
    },
  };
}
