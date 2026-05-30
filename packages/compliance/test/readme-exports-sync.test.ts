// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// README.md is the package's versioned, Apache-licensed public-API document; it ships in the
// npm tarball (package.json "files"). It is the source of truth a consumer reads, so its
// "Public API" export list must match src/index.ts exactly. (ARCHI.md is an internal,
// unversioned planning doc and must never be referenced from versioned files.)
const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

const indexSource = readFileSync(indexPath, "utf8");
const readmeSource = readFileSync(readmePath, "utf8");

// Collect named identifiers from `export { ... } from "..."` (src/index.ts barrel)
// and from `import { ... } from "..."` (the README's documented usage block). Line
// comments inside a brace group are stripped so the README block can stay annotated.
function extractExportIdentifiers(source: string): Set<string> {
  const names = new Set<string>();
  const bracePattern = /(?:import|export)\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gu;
  for (const match of source.matchAll(bracePattern)) {
    const body = (match[1] ?? "").replace(/\/\/[^\n]*/gu, "");
    for (const rawPart of body.split(",")) {
      const part = rawPart.trim().replace(/^type\s+/u, "");
      if (part.length > 0) {
        const segments = part.split(/\s+as\s+/u);
        names.add((segments[segments.length - 1] ?? part).trim());
      }
    }
  }
  return names;
}

function extractPublicApiSection(markdown: string): string {
  const start = markdown.indexOf("## Public API");
  if (start < 0) {
    throw new Error("README.md: '## Public API' section not found");
  }
  const rest = markdown.slice(start);
  const nextHeading = rest.indexOf("\n## ", 1);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function extractTypeScriptBlock(section: string): string {
  const fence = /```(?:typescript|ts)\n([\s\S]*?)```/u.exec(section);
  if (fence === null) {
    throw new Error("README.md '## Public API': no typescript code block found");
  }
  return fence[1] ?? "";
}

const publicApiSection = extractPublicApiSection(readmeSource);
const readmeExports = extractExportIdentifiers(extractTypeScriptBlock(publicApiSection));
const indexExports = extractExportIdentifiers(indexSource);

describe("README Public API matches src/index.ts (R-05)", () => {
  it("documents exactly the identifier set the barrel exports", () => {
    expect([...readmeExports].toSorted()).toEqual([...indexExports].toSorted());
  });

  it("the documented set is non-empty and the same size as the barrel", () => {
    expect(readmeExports.size).toBeGreaterThan(0);
    expect(readmeExports.size).toBe(indexExports.size);
  });

  it("neither source carries the obsolete AuditTrailEventSchema", () => {
    expect(readmeExports.has("AuditTrailEventSchema")).toBe(false);
    expect(indexExports.has("AuditTrailEventSchema")).toBe(false);
  });
});

describe("README documents the internal factories (R-06)", () => {
  it("names createSigner as internal", () => {
    expect(publicApiSection).toMatch(/createSigner/u);
  });

  it("names createFileAuditTrailWriter as internal", () => {
    expect(publicApiSection).toMatch(/createFileAuditTrailWriter/u);
  });

  it("states the factories are not exported / internal", () => {
    expect(publicApiSection.toLowerCase()).toMatch(/internal|not exported/u);
  });
});
