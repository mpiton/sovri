// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdir, readFile } from "node:fs/promises";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  failOnUnhandledRequest,
  getUnhandledRequests,
  resetUnhandledRequests,
  server,
} from "../../../../tests/msw/server.js";

const ProvidersDir = new URL(".", import.meta.url);
const ThisTestFileName = "OpenAIProvider.no-network.test.ts";
const OpenAIHost = ["api", "openai", "com"].join(".");
const OpenAIChatCompletionsUrl = `https://${OpenAIHost}/v1/chat/completions`;

interface ForbiddenOpenAINetworkPattern {
  readonly label: string;
  readonly matches: (source: string) => boolean;
  readonly sample: string;
}

const ForbiddenOpenAINetworkPatterns = [
  {
    label: OpenAIHost,
    matches: (source) => source.toLowerCase().includes(OpenAIHost),
    sample: `https://${OpenAIHost}`,
  },
  {
    label: "OPENAI_API_KEY",
    matches: (source) => /\bOPENAI_API_KEY\b/.test(source),
    sample: "OPENAI_API_KEY",
  },
  {
    label: "new OpenAI({ apiKey })",
    matches: (source) => /\bnew\s+OpenAI\s*\(\s*\{\s*apiKey\b[\s\S]*?\}\s*\)/.test(source),
    sample: "new OpenAI({apiKey: key})",
  },
] satisfies readonly ForbiddenOpenAINetworkPattern[];

interface ProviderTestSource {
  readonly fileName: string;
  readonly source: string;
}

beforeAll(() => server.listen({ onUnhandledRequest: failOnUnhandledRequest }));

afterEach(() => {
  server.resetHandlers();
  resetUnhandledRequests();
});

afterAll(() => server.close());

describe("OpenAIProvider no-network test guard", () => {
  it("keeps OpenAI provider tests on injected fake clients", async () => {
    // Given the test files are under "packages/llm-providers/src/providers"
    // And the OpenAI provider tests use apiKey "test-openai-key"
    // Given "OpenAIProvider.test.ts" constructs an OpenAIProvider
    const sources = await readOpenAIProviderTestSources();
    const contractSource = requireSource(sources, "OpenAIProvider.contract.test.ts");

    // When the test setup is inspected
    // Then the constructor options include "client"
    // And the fake client implements "chat.completions.create"
    // And no real "api.openai.com" request is attempted
    expect(contractSource).toContain("apiKey: TestApiKey,\n      client: fakeOpenAIClient");
    expect(contractSource).toContain("chat: {");
    expect(contractSource).toContain("completions: {");
    expect(contractSource).toContain("create: async");
    expect(allSourcesText(sources)).not.toContain(OpenAIHost);
  });

  it.each(ForbiddenOpenAINetworkPatterns)(
    "rejects forbidden OpenAI provider network pattern $label",
    ({ label, sample }) => {
      // Given the OpenAI provider test code contains "<forbidden_pattern>"
      const source = `new OpenAIProvider({ apiKey: "test-openai-key" });\n${sample}`;

      // When the no-network test guard runs
      const violations = findForbiddenOpenAINetworkPatterns(source);

      // Then the guard fails
      // And the failure names "<forbidden_pattern>"
      expect(violations).toContain(label);
    },
  );

  it("keeps committed OpenAI provider tests free of real OpenAI network dependencies", async () => {
    const sources = await readOpenAIProviderTestSources();

    const violations = sources.flatMap((source) =>
      findForbiddenOpenAINetworkPatterns(source.source).map(
        (forbiddenPattern) => `${source.fileName}: ${forbiddenPattern}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it("fails accidental unhandled OpenAI requests inside MSW", async () => {
    // Given MSW is listening with onUnhandledRequest "error"
    // And an OpenAIProvider test accidentally sends a POST to "https://api.openai.com/v1/chat/completions"
    // When the test runs
    const response = await fetch(OpenAIChatCompletionsUrl, { method: "POST" });

    // Then MSW fails the test
    // And the failure happens before any external OpenAI service is reached
    expect(getUnhandledRequests()).toEqual([{ method: "POST", url: OpenAIChatCompletionsUrl }]);
    expect(response.status).toBe(500);
  });
});

async function readOpenAIProviderTestSources(): Promise<ProviderTestSource[]> {
  const fileNames = (await readdir(ProvidersDir))
    .filter(
      (fileName) =>
        fileName.startsWith("OpenAIProvider.") &&
        fileName.endsWith(".test.ts") &&
        fileName !== ThisTestFileName,
    )
    .toSorted();

  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      source: await readFile(new URL(fileName, ProvidersDir), "utf8"),
    })),
  );
}

function requireSource(sources: ReadonlyArray<ProviderTestSource>, fileName: string): string {
  const match = sources.find((source) => source.fileName === fileName);
  if (match === undefined) {
    throw new Error(`Expected ${fileName} to exist`);
  }

  return match.source;
}

function allSourcesText(sources: ReadonlyArray<ProviderTestSource>): string {
  return sources.map((source) => source.source).join("\n");
}

function findForbiddenOpenAINetworkPatterns(source: string): string[] {
  return ForbiddenOpenAINetworkPatterns.filter(({ matches }) => matches(source)).map(
    ({ label }) => label,
  );
}
