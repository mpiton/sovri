// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildReviewPrompt,
  composeWalkthrough,
  parseLLMReviewResponse,
  parseReviewDiff,
  parseUnifiedDiff,
  runReview,
} from "../src/index.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const previewSourceRoot = join(packageRoot, "src/preview");
const previewScriptRoot = join(packageRoot, "scripts");
const sourceRoot = join(packageRoot, "src");
const workspaceRoot = join(packageRoot, "../..");
const RelativeTypeScriptImportExpression = /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/gu;
const PreviewHtmlOutputRelativePaths: readonly string[] = [
  "packages/review-engine/.preview/comments-light.html",
  "packages/review-engine/.preview/comments-dark.html",
];
const PreviewOnlyRuntimePackages: readonly string[] = [
  "@playwright/test",
  "happy-dom",
  "jsdom",
  "marked",
  "markdown-it",
  "playwright",
  "puppeteer",
  "react",
  "react-dom",
  "vite",
];

interface ReviewEnginePackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly scripts: Readonly<Record<string, string>>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readReviewEnginePackageManifest(): ReviewEnginePackageManifest {
  const manifest = readJson(join(packageRoot, "package.json"));

  if (!isRecord(manifest)) {
    throw new TypeError("Expected review-engine package manifest to be a JSON object.");
  }

  const { dependencies, exports: packageExports, scripts } = manifest;

  if (!isStringRecord(scripts)) {
    throw new TypeError("Expected review-engine package manifest scripts to be string entries.");
  }

  if (dependencies !== undefined && !isStringRecord(dependencies)) {
    throw new TypeError(
      "Expected review-engine package manifest dependencies to be string entries.",
    );
  }

  const validatedManifest = dependencies === undefined ? { scripts } : { dependencies, scripts };

  return packageExports === undefined
    ? validatedManifest
    : { ...validatedManifest, exports: packageExports };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function listTypeScriptFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => extname(path) === ".ts");
}

describe("@sovri/review-engine scaffold", () => {
  it("declares a buildable workspace package with the expected dependencies", () => {
    expect(readJson(join(packageRoot, "package.json"))).toMatchObject({
      name: "@sovri/review-engine",
      license: "Apache-2.0",
      type: "module",
      scripts: { build: "tsup" },
      dependencies: {
        "@sovri/core": "workspace:*",
        "@sovri/llm-providers": "workspace:*",
        "@sovri/observability": "workspace:*",
        "parse-diff": "0.12.0",
        uuid: "14.0.0",
        zod: "4.4.3",
      },
    });
    expect(existsSync(join(packageRoot, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(packageRoot, "tsup.config.ts"))).toBe(true);
  });

  it("exposes the comments preview script without runtime preview dependencies", () => {
    // When the review-engine package manifest is inspected
    const manifest = readReviewEnginePackageManifest();

    // Then the "scripts" object contains "preview:comments"
    expect(manifest.scripts["preview:comments"]).toBeDefined();
    expect(manifest.scripts["preview:comments"]?.length).toBeGreaterThan(0);

    // And the "dependencies" object contains no package added only for preview rendering
    const dependencies = manifest.dependencies ?? {};
    for (const packageName of PreviewOnlyRuntimePackages) {
      expect(dependencies).not.toHaveProperty(packageName);
    }

    // And the preview script is not referenced by the package "build" script
    expect(manifest.scripts.build ?? "").not.toContain("preview:comments");
  });

  it("generates ignored comments preview HTML outside the shipped source surface", () => {
    // Given the preview script writes light and dark HTML files
    const manifest = readReviewEnginePackageManifest();
    removePreviewHtmlOutputs();

    const result = spawnSync("pnpm", ["--filter", "@sovri/review-engine", "preview:comments"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    });

    expect(result.status, formatProcessOutput(result)).toBe(0);

    for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
      const outputPath = join(workspaceRoot, outputRelativePath);

      expect(existsSync(outputPath), `${outputRelativePath} must be generated`).toBe(true);

      // When the repository status is inspected after generation
      const ignoreResult = spawnSync("git", ["check-ignore", "--quiet", outputRelativePath], {
        cwd: workspaceRoot,
        encoding: "utf8",
      });

      // Then the generated HTML files are ignored by Git
      expect(ignoreResult.status, `${outputRelativePath} must be ignored by Git`).toBe(0);
    }

    const packageExports = JSON.stringify(manifest.exports ?? {});
    const rootBarrel = readFileSync(join(sourceRoot, "index.ts"), "utf8");

    // And no generated HTML file is listed in the package exports
    // And no generated HTML file is included by the package root barrel
    for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
      expect(packageExports).not.toContain(outputRelativePath);
      expect(rootBarrel).not.toContain(outputRelativePath);
    }
    expect(packageExports).not.toContain(".preview");
    expect(packageExports).not.toContain(".html");
    expect(rootBarrel).not.toContain(".preview");
    expect(rootBarrel).not.toContain(".html");
  });

  it("keeps preview TypeScript files under the required source contract", () => {
    // Given the new preview source files are under "packages/review-engine/src/preview/"
    const previewSourceFiles = listTypeScriptFiles(previewSourceRoot);
    // And the new preview script is under "packages/review-engine/scripts/"
    const previewScriptFiles = listTypeScriptFilesIfPresent(previewScriptRoot);
    expect(previewSourceFiles.length).toBeGreaterThan(0);
    expect(
      previewScriptFiles,
      "packages/review-engine/scripts/ must contain the preview script TypeScript file",
    ).not.toEqual([]);

    // When the preview source files are inspected
    const inspectedFiles = [...previewSourceFiles, ...previewScriptFiles];

    for (const inspectedFile of inspectedFiles) {
      const content = readFileSync(inspectedFile, "utf8");
      const relativePath = relative(packageRoot, inspectedFile);
      const [spdxHeader, copyrightHeader] = content.split(/\r?\n/u);

      // Then every new TypeScript file starts with "SPDX-License-Identifier: Apache-2.0"
      expect(spdxHeader, `${relativePath} must start with the SPDX header`).toContain(
        "SPDX-License-Identifier: Apache-2.0",
      );
      // And every new TypeScript file starts with "Copyright 2026 Sovri SAS"
      expect(copyrightHeader, `${relativePath} must carry the Sovri copyright header`).toContain(
        "Copyright 2026 Sovri SAS",
      );
      // And every relative TypeScript import uses an explicit ".js" extension
      for (const importSpecifier of collectRelativeImportSpecifiers(content)) {
        expect(
          importSpecifier,
          `${relativePath} relative import "${importSpecifier}" must use a .js extension`,
        ).toMatch(/\.js$/u);
      }
      // And no file contains "require("
      expect(content, `${relativePath} must not contain require(`).not.toContain("require(");
    }
  });

  it("keeps the deferred ingestion format out of production source", () => {
    const deferredToken = ["sa", "rif"].join("");
    const deferredPattern = new RegExp(deferredToken, "iu");
    const sourceFiles = listTypeScriptFiles(sourceRoot).filter(
      (path) => !path.endsWith(".test.ts"),
    );
    const matches = sourceFiles.flatMap((path) => {
      const content = readFileSync(path, "utf8");
      const relativePath = relative(packageRoot, path);
      return deferredPattern.test(relativePath) || deferredPattern.test(content)
        ? [relativePath]
        : [];
    });
    expect(matches).toEqual([]);
  });

  it("separates the review-engine responsibilities into dedicated modules", () => {
    expect(existsSync(join(sourceRoot, "diff/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "prompt/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "parsing/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "walkthrough/index.ts"))).toBe(true);
    expect(existsSync(join(sourceRoot, "orchestrator.ts"))).toBe(true);
  });

  it("exports a thin public surface for the scaffold responsibilities", () => {
    expect(typeof parseReviewDiff).toBe("function");
    expect(typeof buildReviewPrompt).toBe("function");
    expect(typeof parseLLMReviewResponse).toBe("function");
    expect(typeof composeWalkthrough).toBe("function");
    expect(typeof runReview).toBe("function");
    expect(typeof parseUnifiedDiff).toBe("function");
  });
});

function removePreviewHtmlOutputs(): void {
  for (const outputRelativePath of PreviewHtmlOutputRelativePaths) {
    rmSync(join(workspaceRoot, outputRelativePath), { force: true });
  }
}

function listTypeScriptFilesIfPresent(root: string): string[] {
  return existsSync(root) ? listTypeScriptFiles(root) : [];
}

function collectRelativeImportSpecifiers(content: string): readonly string[] {
  return [...content.matchAll(RelativeTypeScriptImportExpression)].flatMap((match) => {
    const importSpecifier = match[1];
    return importSpecifier === undefined ? [] : [importSpecifier];
  });
}

function formatProcessOutput(result: SpawnSyncReturns<string>): string {
  return [result.stdout.trim(), result.stderr.trim()]
    .filter((output) => output.length > 0)
    .join("\n");
}
