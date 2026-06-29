// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as compliance from "../src/index.js";

const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const indexSource = readFileSync(indexPath, "utf8");

// Canonical v0.3 public surface (task-101). Values resolve at runtime; types are
// erased, so they are only observable by parsing the barrel source.
const EXPECTED_VALUE_EXPORTS = [
  "enrichFindingCompliance",
  "ComplianceFrameworkSchema",
  "ComplianceMappingEntrySchema",
  "ComplianceReferenceApplicabilitySchema",
  "ComplianceReferenceEntrySchema",
  "CatalogSchemasByFile",
  "ControlCatalogSchema",
  "FrameworkCatalogSchema",
  "MappingCatalogSchema",
  "RuleCatalogSchema",
  "validateCatalogYaml",
  "AuditTrailLogicalEventSchema",
  "SignedAuditTrailEntrySchema",
  "MemoryAuditTrailSink",
  "verifyAuditTrail",
  "createCommunityAuditTrailWriter",
] as const;

const EXPECTED_TYPE_EXPORTS = [
  "ComplianceFramework",
  "ComplianceMappingEntry",
  "ComplianceReferenceApplicability",
  "ComplianceReferenceEntry",
  "CatalogYamlValidationInput",
  "CatalogYamlValidationIssue",
  "CatalogYamlValidationResult",
  "ControlCatalog",
  "FrameworkCatalog",
  "MappingCatalog",
  "RuleCatalog",
  "AuditTrailLogicalEvent",
  "SignedAuditTrailEntry",
  "AuditTrailSink",
  "VerifyResult",
  "CommunityAuditTrailOptions",
  "CommunityAuditTrailWriter",
] as const;

const EXPECTED_SPECIFIERS = [
  "./mapping/enricher.js",
  "./mapping/schema.js",
  "./catalog/schema.js",
  "./audit-trail/schema.js",
  "./audit-trail/sink.js",
  "./audit-trail/verifier.js",
  "./audit-trail/community-writer.js",
] as const;

// Internal (signer/writer factories), scaffold noise, and internal helpers that
// must never reach the public surface.
const FORBIDDEN_EXPORTS = [
  "createSigner",
  "createFileAuditTrailWriter",
  "compliancePackageName",
  "getCweMap",
] as const;

interface ParsedExports {
  readonly names: ReadonlySet<string>;
  readonly specifiers: readonly string[];
}

function parseExports(source: string): ParsedExports {
  const names = new Set<string>();
  const specifiers: string[] = [];

  const reexportPattern = /export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(reexportPattern)) {
    specifiers.push(match[2] ?? "");
    for (const rawPart of (match[1] ?? "").split(",")) {
      const part = rawPart.trim().replace(/^type\s+/u, "");
      if (part.length > 0) {
        const segments = part.split(/\s+as\s+/u);
        names.add((segments[segments.length - 1] ?? part).trim());
      }
    }
  }

  const declPattern =
    /export\s+(?:declare\s+)?(?:const|let|var|function|async\s+function|class|abstract\s+class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of source.matchAll(declPattern)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }

  return { names, specifiers };
}

const parsed = parseExports(indexSource);
const expectedAll = [...EXPECTED_VALUE_EXPORTS, ...EXPECTED_TYPE_EXPORTS];

describe("@sovri/compliance public export surface (R-01)", () => {
  it("exports exactly the 33 canonical identifiers", () => {
    expect([...parsed.names].toSorted()).toEqual([...expectedAll].toSorted());
  });

  it("counts 16 value exports plus 17 type exports", () => {
    expect(parsed.names.size).toBe(33);
    expect(Object.keys(compliance).toSorted()).toEqual([...EXPECTED_VALUE_EXPORTS].toSorted());
  });
});

describe("internal factories, scaffold and helpers stay internal (R-02)", () => {
  it.each(FORBIDDEN_EXPORTS)("does not export %s", (name) => {
    expect(parsed.names.has(name)).toBe(false);
    expect(Object.keys(compliance)).not.toContain(name);
  });

  it("never names the signer or file-writer factory in the barrel", () => {
    expect(indexSource).not.toMatch(/createSigner/u);
    expect(indexSource).not.toMatch(/createFileAuditTrailWriter/u);
  });
});

describe("re-export specifiers are relative ESM .js (R-03)", () => {
  it("uses exactly the seven expected specifiers", () => {
    expect([...parsed.specifiers].toSorted()).toEqual([...EXPECTED_SPECIFIERS].toSorted());
  });

  it("every specifier is relative and ends with .js", () => {
    expect(parsed.specifiers.length).toBeGreaterThan(0);
    for (const specifier of parsed.specifiers) {
      expect(specifier.startsWith("./")).toBe(true);
      expect(specifier.endsWith(".js")).toBe(true);
    }
  });
});

describe("canonical value exports resolve at runtime (R-01)", () => {
  it("enrichFindingCompliance and verifyAuditTrail are functions", () => {
    expect(typeof compliance.enrichFindingCompliance).toBe("function");
    expect(typeof compliance.verifyAuditTrail).toBe("function");
  });

  it("MemoryAuditTrailSink is a class", () => {
    expect(typeof compliance.MemoryAuditTrailSink).toBe("function");
  });

  it("the mapping schemas expose a Zod parse method", () => {
    expect(typeof compliance.ComplianceMappingEntrySchema.parse).toBe("function");
    expect(typeof compliance.AuditTrailLogicalEventSchema.parse).toBe("function");
    expect(typeof compliance.FrameworkCatalogSchema.parse).toBe("function");
  });

  it("the catalog YAML validator is callable from the package root", () => {
    expect(typeof compliance.validateCatalogYaml).toBe("function");
  });
});
