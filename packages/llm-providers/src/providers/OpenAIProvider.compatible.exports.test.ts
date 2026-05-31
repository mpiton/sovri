// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createOpenAICompatibleProvider,
  type LLMProvider,
  type OpenAICompatibleProviderOptions,
} from "../index.js";
import * as LlmProviders from "../index.js";

const TestApiKey = "test-openai-compatible-key";
const TestBaseUrl = "https://compatible.test/v1";
const InspectedFiles = [
  {
    displayName: "packages/llm-providers/src/providers/OpenAICompatibleProvider.ts",
    path: "OpenAICompatibleProvider.ts",
  },
  { displayName: "packages/llm-providers/src/index.ts", path: "../index.ts" },
  {
    displayName: "packages/llm-providers/src/providers/OpenAIProvider.compatible.exports.test.ts",
    path: "OpenAIProvider.compatible.exports.test.ts",
  },
] satisfies readonly InspectedFile[];
const RequiredRuntimeExports = ["createOpenAICompatibleProvider"] satisfies readonly string[];
const RequiredTypeExports = ["OpenAICompatibleProviderOptions"] satisfies readonly string[];
const ForbiddenTypeScriptTexts = [
  "any",
  "@ts-ignore",
  "@ts-expect-error",
  "require(",
] satisfies readonly string[];
const ExportedOptionsProbe: Pick<OpenAICompatibleProviderOptions, "apiKey" | "baseUrl"> = {
  apiKey: TestApiKey,
  baseUrl: TestBaseUrl,
};

interface InspectedFile {
  readonly displayName: string;
  readonly path: string;
}

interface SourceFile {
  readonly displayName: string;
  readonly source: string;
}

describe("OpenAI-compatible package exports and quality acceptance", () => {
  it("exports the compatible provider API with license headers and ESM imports", async () => {
    // Given the compatible provider implementation lives under "packages/llm-providers/src/providers"
    // And the package export barrel is "packages/llm-providers/src/index.ts"
    // Given the OpenAI-compatible provider files are inspected
    // When the public package exports are collected
    const exportedNames = Object.keys(LlmProviders);
    const indexSource = await readProviderFile("../index.ts");
    const inspectedSources = await readInspectedSources();

    // Then "createOpenAICompatibleProvider" is exported from "packages/llm-providers/src/index.ts"
    // And "OpenAICompatibleProviderOptions" is exported from "packages/llm-providers/src/index.ts"
    // And each new source file starts with "SPDX-License-Identifier: Apache-2.0"
    // And each internal import uses an explicit ".js" extension
    expect(exportedNames).toEqual(expect.arrayContaining(RequiredRuntimeExports));
    expect(findMissingTypeExports(indexSource)).toEqual([]);
    expect(ExportedOptionsProbe.baseUrl).toBe(TestBaseUrl);
    expect(findMissingLicenseHeaders(inspectedSources)).toEqual([]);
    expect(findInternalImportsWithoutJsExtension(inspectedSources)).toEqual([]);
  });

  it.each(ForbiddenTypeScriptTexts)(
    "names forbidden TypeScript escape hatch %s",
    (forbiddenText) => {
      // Given a new OpenAI-compatible provider source file contains "<forbidden_text>"
      const source = sourceWithForbiddenText(forbiddenText);

      // When "pnpm exec oxlint packages/llm-providers" and "pnpm exec tsc -b" run
      const violations = findForbiddenTypeScriptTexts(source);

      // Then the quality gate fails
      // And the failure names "<forbidden_text>"
      expect(violations).toContain(forbiddenText);
    },
  );

  it("keeps OpenAI-compatible public source files free of forbidden escape hatches", async () => {
    const sources = await readProductionSurfaceSources();

    expect(findForbiddenTypeScriptTextViolations(sources)).toEqual([]);
  });

  it("exports the compatible helper through the package entrypoint as an LLMProvider", () => {
    // Given "OpenAIProvider.compatible.exports.test.ts" imports createOpenAICompatibleProvider from "../index.js"
    // When the test constructs a provider with an injected fake client and baseUrl "https://compatible.test/v1"
    const provider: LLMProvider = createOpenAICompatibleProvider({
      apiKey: TestApiKey,
      baseUrl: TestBaseUrl,
      client: fakeOpenAIClient(),
    });

    // Then the provider is assignable to LLMProvider
    // And provider.name equals "openai-compatible"
    // And provider.generateStructuredWithUsage equals a function
    expect(provider.name).toBe("openai-compatible");
    expect(provider.generateStructuredWithUsage).toEqual(expect.any(Function));
  });
});

function fakeOpenAIClient(): NonNullable<OpenAICompatibleProviderOptions["client"]> {
  return {
    chat: {
      completions: {
        create: () => {
          throw new Error("OpenAI-compatible exports test should not create chat completions");
        },
      },
    },
  };
}

async function readInspectedSources(): Promise<SourceFile[]> {
  return Promise.all(
    InspectedFiles.map(async (file) => ({
      displayName: file.displayName,
      source: await readProviderFile(file.path),
    })),
  );
}

async function readProductionSurfaceSources(): Promise<SourceFile[]> {
  return Promise.all(
    ["OpenAICompatibleProvider.ts", "../index.ts"].map(async (fileName) => ({
      displayName: fileName,
      source: await readProviderFile(fileName),
    })),
  );
}

function findMissingLicenseHeaders(sources: readonly SourceFile[]): string[] {
  return sources
    .filter((source) => !source.source.startsWith("// SPDX-License-Identifier: Apache-2.0"))
    .map((source) => source.displayName);
}

function findInternalImportsWithoutJsExtension(sources: readonly SourceFile[]): string[] {
  return sources.flatMap((source) =>
    findInternalImportSpecifiers(source.source)
      .filter((specifier) => specifier.startsWith(".") && !specifier.endsWith(".js"))
      .map((specifier) => `${source.displayName}: ${specifier}`),
  );
}

function findInternalImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\bfrom\s+["']([^"']+)["']/g;
  let match = pattern.exec(source);

  while (match !== null) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
    match = pattern.exec(source);
  }

  return specifiers;
}

function findMissingTypeExports(indexSource: string): string[] {
  return RequiredTypeExports.filter((exportName) => !indexSource.includes(`type ${exportName}`));
}

function findForbiddenTypeScriptTextViolations(sources: readonly SourceFile[]): string[] {
  return sources.flatMap((source) =>
    findForbiddenTypeScriptTexts(source.source).map(
      (forbiddenText) => `${source.displayName}: ${forbiddenText}`,
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
