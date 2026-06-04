// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const COMPLIANCE_SOURCE_URL = new URL("./compliance.ts", import.meta.url);
const WALKTHROUGH_INDEX_SOURCE_URL = new URL("./index.ts", import.meta.url);
const REVIEW_ENGINE_SOURCE_URL = new URL("../", import.meta.url);
const CORE_REVIEW_SOURCE_URL = new URL("../../../core/src/types/Review.ts", import.meta.url);

const PROVENANCE_WALKTHROUGH_SOURCE_URLS: readonly URL[] = [
  COMPLIANCE_SOURCE_URL,
  WALKTHROUGH_INDEX_SOURCE_URL,
];
const INTERNAL_IMPORT_PATTERN = /from\s+"(?<specifier>\.[^"]+)"/gu;
const CLOUD_IMPORT_PATTERN =
  /(?:from\s+"[^"]*apps\/cloud-api|import\s*\(\s*"[^"]*apps\/cloud-api)/u;
const TOP_TYPE_PATTERN = new RegExp(`\\b${"a"}${"ny"}\\b`, "u");
const TYPE_ASSERTION_PATTERN = new RegExp(`\\s${"a"}${"s"}\\s`, "u");
const TS_IGNORE_DIRECTIVE = `${"@ts"}-ignore`;
const TS_EXPECT_ERROR_DIRECTIVE = `${"@ts"}-expect-error`;
const OXLINT_DISABLE_DIRECTIVE = `${"oxlint"}-disable`;

describe("compliance provenance implementation quality contract (R-11)", () => {
  it("keeps provenance walkthrough files Apache-licensed and ESM-explicit", () => {
    // Given the production walkthrough files changed by compliance provenance work
    const sources = readProvenanceWalkthroughSources();

    for (const source of sources) {
      const lines = source.text.split(/\r?\n/u);

      // Then the Apache 2.0 public package headers remain intact
      expect(lines[0]).toBe("// SPDX-License-Identifier: Apache-2.0");
      expect(lines[1]).toBe("// Copyright 2026 Sovri SAS");
      // And every internal relative import uses an explicit ".js" extension
      const internalImports = extractInternalRelativeImports(source.text);
      expect(internalImports.length, source.label).toBeGreaterThan(0);
      expect(
        internalImports.every((specifier) => specifier.endsWith(".js")),
        source.label,
      ).toBe(true);
    }
  });

  it("keeps provenance walkthrough files free of TypeScript escape hatches", () => {
    // Given the production walkthrough files changed by compliance provenance work
    const sources = readProvenanceWalkthroughSources();

    for (const source of sources) {
      // Then the implementation contains no forbidden escape hatches
      expect(source.text, source.label).not.toMatch(TOP_TYPE_PATTERN);
      expect(source.text, source.label).not.toMatch(TYPE_ASSERTION_PATTERN);
      expect(source.text, source.label).not.toContain(TS_IGNORE_DIRECTIVE);
      expect(source.text, source.label).not.toContain(TS_EXPECT_ERROR_DIRECTIVE);
      expect(source.text, source.label).not.toContain(OXLINT_DISABLE_DIRECTIVE);
    }
  });

  it("keeps walkthrough provenance typed from its Zod schema", () => {
    // Given the walkthrough input boundary source
    const source = readFileSync(WALKTHROUGH_INDEX_SOURCE_URL, "utf8");

    // Then provenance remains a Zod contract with a derived TypeScript type
    expect(source).toContain("export const WalkthroughProvenanceSchema = z");
    expect(source).toContain(
      "type WalkthroughProvenance = z.infer<typeof WalkthroughProvenanceSchema>;",
    );
    expect(source).not.toContain("interface WalkthroughProvenance");
    expect(source).not.toMatch(/type\s+WalkthroughProvenance\s*=\s*\{/u);
  });

  it("keeps Community package boundaries out of review-engine imports", () => {
    // Given every TypeScript source file in packages/review-engine/src
    const sources = collectTypeScriptFiles(REVIEW_ENGINE_SOURCE_URL).map((sourceUrl) => ({
      label: sourceUrl.pathname,
      text: readFileSync(sourceUrl, "utf8"),
    }));

    // Then review-engine does not import proprietary Cloud code
    for (const source of sources) {
      expect(source.text, source.label).not.toMatch(CLOUD_IMPORT_PATTERN);
    }
  });

  it("keeps prompt digest and signed audit fields out of the core review schema", () => {
    // Given the pure core ReviewSchema source
    const source = readFileSync(CORE_REVIEW_SOURCE_URL, "utf8");

    // Then prompt digest and signed audit-entry provenance stay at the walkthrough boundary
    expect(source).not.toContain("prompt_sha256");
    expect(source).not.toContain("promptSha256");
    expect(source).not.toContain("signed_audit_entry");
    expect(source).not.toContain("signedAuditEntry");
  });
});

function readProvenanceWalkthroughSources(): readonly {
  readonly label: string;
  readonly text: string;
}[] {
  return PROVENANCE_WALKTHROUGH_SOURCE_URLS.map((sourceUrl) => ({
    label: sourceUrl.pathname,
    text: readFileSync(sourceUrl, "utf8"),
  }));
}

function extractInternalRelativeImports(source: string): readonly string[] {
  const specifiers: string[] = [];

  for (const match of source.matchAll(INTERNAL_IMPORT_PATTERN)) {
    const specifier = match.groups?.specifier;
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function collectTypeScriptFiles(directoryUrl: URL): readonly URL[] {
  const files: URL[] = [];

  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);

    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(childUrl));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(childUrl);
    }
  }

  return files;
}
