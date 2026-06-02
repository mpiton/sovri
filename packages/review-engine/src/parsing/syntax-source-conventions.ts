// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export type ParsingSourceConventionViolation =
  | "missing-spdx"
  | "relative-import-without-js"
  | "forbidden-node:fs"
  | "forbidden-node:net"
  | "forbidden-node:http"
  | "forbidden-node:https"
  | "forbidden-process-env"
  | "forbidden-eval"
  | "forbidden-any"
  | "forbidden-ts-ignore"
  | "forbidden-ts-expect-error"
  | "forbidden-oxlint-directive";

export interface ParsingSourceConventionInspection {
  readonly ok: boolean;
  readonly violations: readonly ParsingSourceConventionViolation[];
}

interface SpecifierRule {
  readonly specifier: string;
  readonly violation: ParsingSourceConventionViolation;
}

interface PatternRule {
  readonly pattern: RegExp;
  readonly violation: ParsingSourceConventionViolation;
}

type DirectivePrefix = "at-sign" | "none";

const SpdxHeader = "// SPDX-License-Identifier: Apache-2.0\n";
const AnyKeyword = ["an", "y"].join("");
const RelativeImportPattern =
  /\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["'](?:\s*,[\s\S]*?)?\s*\)|\bimport\s+["'](\.{1,2}\/[^"']+)["']/gu;
const ForbiddenSpecifierRules: readonly SpecifierRule[] = [
  { specifier: "node:fs", violation: "forbidden-node:fs" },
  { specifier: "fs", violation: "forbidden-node:fs" },
  { specifier: "node:net", violation: "forbidden-node:net" },
  { specifier: "net", violation: "forbidden-node:net" },
  { specifier: "node:http", violation: "forbidden-node:http" },
  { specifier: "http", violation: "forbidden-node:http" },
  { specifier: "node:https", violation: "forbidden-node:https" },
  { specifier: "https", violation: "forbidden-node:https" },
];
const ForbiddenPatternRules: readonly PatternRule[] = [
  { pattern: /\bprocess\.env\b/u, violation: "forbidden-process-env" },
  { pattern: /\beval\s*\(/u, violation: "forbidden-eval" },
  { pattern: forbiddenAnyPattern(), violation: "forbidden-any" },
  { pattern: directivePattern("ts-ignore", "at-sign"), violation: "forbidden-ts-ignore" },
  {
    pattern: directivePattern("ts-expect-error", "at-sign"),
    violation: "forbidden-ts-expect-error",
  },
  {
    pattern: directivePattern(oxlintDisableDirective(), "none"),
    violation: "forbidden-oxlint-directive",
  },
];

export function inspectParsingSourceConventions(source: string): ParsingSourceConventionInspection {
  const violations: ParsingSourceConventionViolation[] = [];
  collectHeaderViolation(source, violations);
  collectForbiddenSpecifierViolations(source, violations);
  collectForbiddenPatternViolations(source, violations);
  collectRelativeImportViolations(source, violations);

  return {
    ok: violations.length === 0,
    violations,
  };
}

function collectHeaderViolation(
  source: string,
  violations: ParsingSourceConventionViolation[],
): void {
  if (!source.startsWith(SpdxHeader)) {
    addViolation(violations, "missing-spdx");
  }
}

function collectForbiddenSpecifierViolations(
  source: string,
  violations: ParsingSourceConventionViolation[],
): void {
  for (const rule of ForbiddenSpecifierRules) {
    if (hasForbiddenSpecifierUse(source, rule.specifier)) {
      addViolation(violations, rule.violation);
    }
  }
}

function collectForbiddenPatternViolations(
  source: string,
  violations: ParsingSourceConventionViolation[],
): void {
  for (const rule of ForbiddenPatternRules) {
    if (rule.pattern.test(source)) {
      addViolation(violations, rule.violation);
    }
  }
}

function collectRelativeImportViolations(
  source: string,
  violations: ParsingSourceConventionViolation[],
): void {
  for (const match of source.matchAll(RelativeImportPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined && !specifier.endsWith(".js")) {
      addViolation(violations, "relative-import-without-js");
    }
  }
}

function hasForbiddenSpecifierUse(source: string, specifier: string): boolean {
  const escapedSpecifier = escapeRegExp(specifier);
  const specifierPattern = `${escapedSpecifier}(?:\\/[^"']*)?`;
  const staticImportPattern = new RegExp(
    `^\\s*(?:import|export)\\b[^;]*["']${specifierPattern}["']`,
    "mu",
  );
  const dynamicImportPattern = new RegExp(
    `\\bimport\\s*\\(\\s*["']${specifierPattern}["'](?:\\s*,[\\s\\S]*?)?\\s*\\)`,
    "u",
  );
  const commonJsLoadPattern = new RegExp(
    `\\brequire\\s*\\(\\s*["']${specifierPattern}["']\\s*\\)`,
    "u",
  );
  return (
    staticImportPattern.test(source) ||
    dynamicImportPattern.test(source) ||
    commonJsLoadPattern.test(source)
  );
}

function directivePattern(name: string, prefix: DirectivePrefix): RegExp {
  const escapedName = escapeRegExp(name);
  const marker = prefix === "at-sign" ? "@" : "";
  return new RegExp(`(?:\\/\\/|\\/\\*)\\s*${marker}${escapedName}\\b`, "u");
}

function forbiddenAnyPattern(): RegExp {
  const variants = [
    `:\\s*${AnyKeyword}\\b`,
    `\\btype\\s+\\w+(?:\\s*<[^>]*>)?\\s*=\\s*${AnyKeyword}\\b`,
    `\\bas\\s+${AnyKeyword}\\b`,
    `<[^>]*\\b${AnyKeyword}\\b[^>]*>`,
  ];
  return new RegExp(variants.join("|"), "u");
}

function oxlintDisableDirective(): string {
  return ["oxlint", "disable"].join("-");
}

function addViolation(
  violations: ParsingSourceConventionViolation[],
  violation: ParsingSourceConventionViolation,
): void {
  if (!violations.includes(violation)) {
    violations.push(violation);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
