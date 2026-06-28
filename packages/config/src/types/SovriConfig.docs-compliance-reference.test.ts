// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseConfigContent } from "../loader.js";

// Rule R-05: the public .sovri.yml reference documents compliance as the only review.mode
// (allowed value + default) and presents no removed mode. Mirrors
//   specs/mat-78-config-review-mode-compliance-only/r05-docs-reference-compliance.feature.

const ReferenceUrl = new URL("../../../../docs/sovri-yml-reference.md", import.meta.url);

function readReference(): string {
  return readFileSync(ReferenceUrl, "utf8");
}

function reviewModeRow(reference: string): string {
  const row = reference.split("\n").find((line) => line.trimStart().startsWith("| `review.mode`"));
  expect(row).toBeDefined();
  return row ?? "";
}

describe("R-05 — the .sovri.yml reference documents compliance as the only review mode", () => {
  // @nominal
  // Scenario: The field reference documents compliance as the sole allowed value and default
  it("documents compliance as the allowed value and default for review.mode", () => {
    const row = reviewModeRow(readReference());

    expect(row).toContain("`compliance`");
    expect(row).toContain("Default: `compliance`");
  });

  // @nominal
  // Scenario: The reference's example .sovri.yml uses compliance and round-trips through the schema
  it("parses the Full Mistral example to review.mode compliance", () => {
    const reference = readReference();
    const headingIndex = reference.indexOf("### Full Mistral Example");
    expect(headingIndex).toBeGreaterThanOrEqual(0);

    const yamlFence = /```yaml\n([\s\S]*?)\n```/u.exec(reference.slice(headingIndex));
    expect(yamlFence).not.toBeNull();

    const config = parseConfigContent(yamlFence?.[1] ?? "", "full-mistral.sovri.yml");

    expect(config.review.mode).toBe("compliance");
  });

  // @violation
  // Scenario: The reference carries no guidance pointing at a removed mode
  it("offers none of the removed modes as a selectable review.mode value", () => {
    const row = reviewModeRow(readReference());

    expect(row).not.toContain("Use `strict`");
    expect(row).not.toContain("bugs-only");
    expect(row).not.toContain("strict");
    expect(row).not.toContain("minimal");
  });
});
