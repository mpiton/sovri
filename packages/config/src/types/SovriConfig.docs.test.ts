// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseConfigContent } from "../loader.js";

const RepoRootUrl = new URL("../../../../", import.meta.url);
const ReferencePath = "docs/sovri-yml-reference.md";

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, RepoRootUrl), "utf8");
}

function extractYamlFenceAfter(markdown: string, heading: string): string {
  const headingIndex = markdown.indexOf(heading);
  expect(headingIndex).toBeGreaterThanOrEqual(0);

  const afterHeading = markdown.slice(headingIndex);
  const yamlFence = /```yaml\n([\s\S]*?)\n```/u.exec(afterHeading);
  expect(yamlFence).not.toBeNull();

  return yamlFence?.[1] ?? "";
}

describe(".sovri.yml public reference", () => {
  it("documents every active v0.2 schema field and excludes unreleased fields", () => {
    // Given the active schema is exported from "packages/config/src/types/SovriConfig.ts"
    // And the public reference is "docs/sovri-yml-reference.md"
    const reference = readRepoFile(ReferencePath);

    // When the public reference is inspected
    // Then it documents every active schema field
    expect(reference).toContain("`llm.provider`");
    expect(reference).toContain("`llm.model`");
    expect(reference).toContain("`llm.baseUrl`");
    expect(reference).toContain("`llm.apiKeySecret`");
    expect(reference).toContain("`review.mode`");
    expect(reference).toContain("`review.autoReviewDrafts`");
    expect(reference).toContain("`review.severityThreshold`");
    expect(reference).toContain("`ignores`");
    expect(reference).toContain("`limits.maxFilesPerReview`");
    expect(reference).toContain("`limits.maxLinesPerReview`");

    // Then it does not document fields not enabled in v0.2
    expect(reference).not.toContain("sarif");
    expect(reference).not.toContain("maxCostPerPrUsd");
  });

  it("documents types, defaults, allowed values, and safe secret handling", () => {
    // Given the public reference is "docs/sovri-yml-reference.md"
    const reference = readRepoFile(ReferencePath);

    // When the field documentation is checked
    // Then the required and optional LLM fields document their runtime contract
    expect(reference).toContain("`anthropic`, `mistral`");
    expect(reference).toContain("No schema default");
    expect(reference).toContain("Optional HTTPS URL");
    expect(reference).toContain("Environment variable name");

    // Then review and limits fields document defaults and allowed values
    expect(reference).toContain("`compliance`");
    expect(reference).toContain("Default: `compliance`");
    expect(reference).toContain("Default: `false`");
    expect(reference).toContain("`blocker`, `major`, `minor`");
    expect(reference).toContain("Default: `minor`");
    expect(reference).toContain("Default: `50`");
    expect(reference).toContain("Default: `5000`");

    // Then security-sensitive fields explain safe environment variable use
    expect(reference).toContain("never the API key value");
    expect(reference).toContain("`ANTHROPIC_API_KEY`");
    expect(reference).toContain("`MISTRAL_API_KEY`");
  });

  it("contains valid minimal Anthropic and full Mistral examples", () => {
    // Given the public reference is "docs/sovri-yml-reference.md"
    const reference = readRepoFile(ReferencePath);

    // When the minimal example YAML is parsed
    const minimal = parseConfigContent(
      extractYamlFenceAfter(reference, "### Minimal Anthropic Example"),
      "minimal-anthropic.sovri.yml",
    );

    // Then the parsed provider is "anthropic"
    expect(minimal.llm.provider).toBe("anthropic");
    expect(minimal.llm.apiKeySecret).toBe("ANTHROPIC_API_KEY");

    // When the full example YAML is parsed
    const full = parseConfigContent(
      extractYamlFenceAfter(reference, "### Full Mistral Example"),
      "full-mistral.sovri.yml",
    );

    // Then it validates against "SovriConfigSchema"
    // And the parsed provider is "mistral"
    // And the parsed review mode is "compliance"
    // And it contains exactly 5 ignore patterns
    expect(full.llm.provider).toBe("mistral");
    expect(full.llm.model).toBe("mistral-large-latest");
    expect(full.llm.apiKeySecret).toBe("MISTRAL_API_KEY");
    expect(full.review.mode).toBe("compliance");
    expect(full.ignores).toHaveLength(5);
  });

  it("links the reference from README, CONTRIBUTING, and CHANGELOG", () => {
    // Given the public reference is "docs/sovri-yml-reference.md"
    const readme = readRepoFile("README.md");
    const contributing = readRepoFile("CONTRIBUTING.md");
    const changelog = readRepoFile("CHANGELOG.md");

    // When public documentation links are inspected
    // Then README links to the reference and names both active provider variables
    expect(readme).toContain("docs/sovri-yml-reference.md");
    expect(readme).toContain("ANTHROPIC_API_KEY");
    expect(readme).toContain("MISTRAL_API_KEY");
    expect(readme).toContain("Anthropic");
    expect(readme).toContain("Mistral");

    // Then CONTRIBUTING links to the reference
    expect(contributing).toContain("docs/sovri-yml-reference.md");

    // Then CHANGELOG [Unreleased] links to the reference under Added
    expect(changelog).toMatch(
      /## \[Unreleased\][\s\S]*### Added[\s\S]*docs\/sovri-yml-reference\.md/u,
    );
  });
});
