// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
const sourceRoot = join(packageRoot, "src");
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

  const { dependencies, scripts } = manifest;

  if (!isStringRecord(scripts)) {
    throw new TypeError("Expected review-engine package manifest scripts to be string entries.");
  }

  if (dependencies !== undefined && !isStringRecord(dependencies)) {
    throw new TypeError(
      "Expected review-engine package manifest dependencies to be string entries.",
    );
  }

  return dependencies === undefined ? { scripts } : { dependencies, scripts };
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
