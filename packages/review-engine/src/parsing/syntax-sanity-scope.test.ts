// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { isSyntacticallySane } from "./syntax-sanity.js";

const CurrentDirectory = dirname(fileURLToPath(import.meta.url));
const WorkspaceRoot = join(CurrentDirectory, "../../../..");
const PackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
const AstParserPackages: readonly string[] = [
  "@babel/parser",
  "@typescript-eslint/parser",
  "acorn",
  "espree",
  "meriyah",
  "recast",
  "tree-sitter",
  "ts-morph",
];
const CoveredLanguages: readonly string[] = ["TypeScript", "JavaScript", "Python", "Rust", "Go"];

describe("syntax sanity validation scope", () => {
  it("documents lightweight committable suggestion validation without full AST validation", () => {
    // Given CHANGELOG.md has an [Unreleased] section
    const changelog = readWorkspaceFile("CHANGELOG.md");
    const unreleasedSection = extractMarkdownSection(changelog, "## [Unreleased]", "##");

    // When the task-111 changelog entry is inspected
    const addedSection = extractMarkdownSection(unreleasedSection, "### Added", "###");
    const taskEntry = findChangelogEntry(addedSection, [
      "`feat(review-engine)`",
      "committable suggestions",
    ]);

    // Then it is under "Added"
    expect(addedSection).toContain(taskEntry);

    // And it uses the scope "feat(review-engine)"
    expect(taskEntry).toContain("`feat(review-engine)`");

    // And it says committable suggestions use lightweight syntactic validation
    expect(taskEntry).toContain("committable suggestions use lightweight syntactic validation");

    // And it says full AST validation is not included
    expect(taskEntry).toContain("full AST validation is not included");
  });

  it("keeps parser dependencies absent from the review-engine task scope", () => {
    // Given packages/review-engine/package.json is inspected
    const packageJson = PackageJsonSchema.parse(
      JSON.parse(readWorkspaceFile("packages/review-engine/package.json")),
    );

    // When runtime dependencies and devDependencies are compared to the task baseline
    const declaredDependencies = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);

    // Then no new AST parser dependency is present
    for (const parserPackage of AstParserPackages) {
      expect(declaredDependencies.has(parserPackage), parserPackage).toBe(false);
    }

    // And pnpm-lock.yaml has no new parser package solely for task-111
    const reviewEngineLockImporter = extractLockImporter(
      readWorkspaceFile("pnpm-lock.yaml"),
      "packages/review-engine:",
    );
    expect(reviewEngineLockImporter).toContain("dependencies:");
    for (const parserPackage of AstParserPackages) {
      expect(hasLockDependencyKey(reviewEngineLockImporter, parserPackage), parserPackage).toBe(
        false,
      );
    }
  });

  it("does not claim language validity for a balanced language-specific snippet", () => {
    // Given the candidate suggestion code is "const value = maybeValidButLanguageSpecific<Thing>();"
    const code = "const value = maybeValidButLanguageSpecific<Thing>();";

    // When the syntactic sanity helper validates the code
    const result = isSyntacticallySane(code);

    // Then the result is based only on delimiter, quote, and truncation checks
    expect(result).toBe(true);

    // And no assertion claims that the code is valid TypeScript, JavaScript, Python, Rust, or Go
    const assertionLines = readWorkspaceFile(
      "packages/review-engine/src/parsing/syntax-sanity-scope.test.ts",
    )
      .split("\n")
      .filter((line) => line.includes("expect("))
      .join("\n");
    for (const language of CoveredLanguages) {
      const forbiddenClaim = ["valid", language].join(" ");
      expect(assertionLines).not.toContain(forbiddenClaim);
    }
  });
});

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(WorkspaceRoot, relativePath), "utf8");
}

function extractMarkdownSection(source: string, heading: string, nextHeading: string): string {
  const start = source.indexOf(heading);
  if (start === -1) {
    return "";
  }

  const bodyStart = start + heading.length;
  const body = source.slice(bodyStart);
  const nextStart = body.search(new RegExp(`\\n${nextHeading} `, "u"));
  return nextStart === -1 ? body : body.slice(0, nextStart);
}

function findChangelogEntry(section: string, requiredFragments: readonly string[]): string {
  const entry = section
    .split(/\n(?=- )/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => requiredFragments.every((fragment) => candidate.includes(fragment)));

  return entry ?? "";
}

function extractLockImporter(lockfile: string, importer: string): string {
  const lines = lockfile.split("\n");
  const start = lines.findIndex((line) => line === `  ${importer}`);
  if (start === -1) {
    return "";
  }

  const importerLines: string[] = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("  ") && !line.startsWith("    ")) {
      break;
    }
    importerLines.push(line);
  }

  return importerLines.join("\n");
}

function hasLockDependencyKey(lockImporter: string, dependencyName: string): boolean {
  const escapedDependencyName = escapeRegExp(dependencyName);
  const dependencyKeyPattern = new RegExp(
    `^\\s+(?:'|")?${escapedDependencyName}(?:'|")?:\\s*$`,
    "u",
  );
  return lockImporter.split("\n").some((line) => dependencyKeyPattern.test(line));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
