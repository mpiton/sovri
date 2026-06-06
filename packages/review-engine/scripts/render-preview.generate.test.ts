// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildPreviewFixtureSections,
  renderPreviewHtml,
  validatePreviewRenderedOutput,
  type PreviewHtmlTheme,
} from "../src/preview/render-preview.js";

interface PreviewGoldenCase {
  readonly shape: string;
  readonly fixture: string;
  readonly golden: string;
}

interface PreviewThemeOutput {
  readonly fileName: string;
  readonly theme: PreviewHtmlTheme;
}

const PreviewOutputDirectory = fileURLToPath(new URL("../.preview/", import.meta.url));
const PreviewGoldenCases: readonly PreviewGoldenCase[] = [
  {
    shape: "summary",
    fixture: "summary.review.json",
    golden: "summary.golden.md",
  },
  {
    shape: "assessment",
    fixture: "assessment.review.json",
    golden: "assessment.golden.md",
  },
  {
    shape: "inline finding",
    fixture: "inline-finding.json",
    golden: "inline-finding.golden.md",
  },
  {
    shape: "compliance provenance",
    fixture: "provenance.review.json",
    golden: "provenance.golden.md",
  },
];
const PreviewThemeOutputs: readonly PreviewThemeOutput[] = [
  {
    fileName: "comments-light.html",
    theme: "light",
  },
  {
    fileName: "comments-dark.html",
    theme: "dark",
  },
];

describe("preview comments HTML generator", () => {
  it("writes light and dark preview HTML files outside the shipped source surface", () => {
    mkdirSync(PreviewOutputDirectory, { recursive: true });
    const sections = buildPreviewFixtureSections(
      PreviewGoldenCases,
      PreviewGoldenCases.map(({ fixture }) => fixture),
    );

    for (const { fileName, theme } of PreviewThemeOutputs) {
      const outputPath = join(PreviewOutputDirectory, fileName);
      const html = renderPreviewHtml({ sections, theme });
      const outputValidation = validatePreviewRenderedOutput(html);

      expect(outputValidation.ok).toBe(true);
      expect(outputValidation.forbiddenFragments).toEqual([]);
      writeFileSync(outputPath, ensureFinalNewline(html), "utf8");

      const writtenHtml = readFileSync(outputPath, "utf8");
      expect(writtenHtml).toContain(`gh-${theme}`);
      expect(writtenHtml).toContain("<section>");
    }
  });
});

function ensureFinalNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
