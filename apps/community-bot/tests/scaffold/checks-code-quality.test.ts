// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readRepoFile, repoRoot } from "./helpers.js";

const ChecksDescriptorHelperPath = "packages/review-engine/src/checks/index.ts";
const ChecksPosterAdapterPath = "apps/community-bot/src/github/pull-request-checks.ts";
const InternalImportPattern = /from\s+["'](?<specifier>\.{1,2}\/[^"']+)["']/gu;

describe("checks implementation code-quality contract (R-10)", () => {
  it("keeps project headers and ESM imports on the checks source files", () => {
    // Given the checks descriptor helper source file exists
    expect(sourceFileExists(ChecksDescriptorHelperPath)).toBe(true);
    // And the checks poster adapter source file exists
    expect(sourceFileExists(ChecksPosterAdapterPath)).toBe(true);

    const sources = [
      readRepoFile(ChecksDescriptorHelperPath),
      readRepoFile(ChecksPosterAdapterPath),
    ];

    // When the source files are inspected
    // Then each file starts with "// SPDX-License-Identifier: Apache-2.0"
    expect(
      sources.every((source) => source.startsWith("// SPDX-License-Identifier: Apache-2.0")),
    ).toBe(true);
    // And each file includes "// Copyright 2026 Sovri SAS"
    expect(sources.every((source) => source.includes("// Copyright 2026 Sovri SAS"))).toBe(true);
    // And every internal import uses an explicit ".js" extension
    expect(sources.flatMap((source) => internalImportsWithoutJsExtension(source))).toEqual([]);
  });

  it("keeps the checks helper input contract Zod-derived and escape-hatch free", () => {
    // Given the checks descriptor helper source file exists
    expect(sourceFileExists(ChecksDescriptorHelperPath)).toBe(true);

    // When the helper input contract is inspected
    const source = readRepoFile(ChecksDescriptorHelperPath);

    // Then the input schema is a Zod schema
    expect(source).toMatch(/export const MapChecksInputSchema = z\s*\./u);
    // And the exported input type is derived with "z.infer"
    expect(source).toMatch(/export type MapChecksInput = z\.infer<typeof MapChecksInputSchema>/u);
    // And the implementation contains no "any"
    expect(source).not.toMatch(/\bany\b/u);
    // And the implementation contains no "@ts-ignore"
    expect(source).not.toContain("@ts-ignore");
    // And the implementation contains no "@ts-expect-error"
    expect(source).not.toContain("@ts-expect-error");
  });

  it("keeps checks logging and output payload-safe", () => {
    // Given the checks poster adapter source file exists
    expect(sourceFileExists(ChecksPosterAdapterPath)).toBe(true);

    // When the logging path is inspected
    const source = readRepoFile(ChecksPosterAdapterPath);

    // Then checks failures are logged with delivery id, repository, and pull request number
    expect(source).toContain("delivery_id");
    expect(source).toContain("repo");
    expect(source).toContain("pr_number");
    // And no log statement includes a GitHub token
    expect(source).not.toMatch(/github[_-]?token|installation[_-]?token/iu);
    // And no log statement includes an LLM key
    expect(source).not.toMatch(/llm[_-]?key|api[_-]?key/iu);
    // And no log statement includes a raw webhook payload
    expect(source).not.toMatch(/raw[_-]?webhook|payload/iu);
  });
});

function sourceFileExists(relativePath: string): boolean {
  return existsSync(resolve(repoRoot, relativePath));
}

function internalImportsWithoutJsExtension(source: string): readonly string[] {
  return Array.from(source.matchAll(InternalImportPattern))
    .map((match) => match.groups?.specifier)
    .filter((specifier): specifier is string => specifier !== undefined)
    .filter((specifier) => !specifier.endsWith(".js"));
}
