// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as RenderPreviewModule from "./render-preview.js";
import { renderPreviewFixtureMarkdown, validatePreviewFixtureCatalog } from "./render-preview.js";

interface PreviewGoldenCase {
  readonly shape: string;
  readonly fixture: string;
  readonly golden: string;
}

type PreviewTheme = "light" | "dark";

interface PreviewHtmlSection {
  readonly title: string;
  readonly markdown: string;
}

interface PreviewHtmlRequest {
  readonly sections: readonly PreviewHtmlSection[];
  readonly theme: PreviewTheme;
}

type RenderPreviewHtml = (request: PreviewHtmlRequest) => string;

interface PreviewThemeCase {
  readonly theme: PreviewTheme;
  readonly themeClass: string;
  readonly otherThemeClass: string;
}

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

const PreviewHtmlSections: readonly PreviewHtmlSection[] = [
  {
    title: "Summary",
    markdown: "## Approve",
  },
  {
    title: "Inline finding",
    markdown: "Major: Escape user-supplied HTML",
  },
];

const PreviewThemeCases: readonly PreviewThemeCase[] = [
  {
    theme: "light",
    themeClass: "gh-light",
    otherThemeClass: "gh-dark",
  },
  {
    theme: "dark",
    themeClass: "gh-dark",
    otherThemeClass: "gh-light",
  },
];

describe("preview markdown golden fixtures", () => {
  it.each(PreviewGoldenCases)(
    "renders $shape markdown byte-for-byte from $fixture",
    ({ fixture, golden }) => {
      // And the stored markdown snapshot is "<golden>"
      const expectedMarkdown = loadTextFixture(golden);

      // When the preview harness renders markdown for the fixture
      const markdown = renderPreviewFixtureMarkdown(fixture);

      // Then the rendered markdown equals the stored markdown byte-for-byte
      expect(markdown).toBe(expectedMarkdown);
      // And the rendered markdown is not empty
      expect(markdown.length).toBeGreaterThan(0);
    },
  );

  it("rejects a fixture catalog when a stored markdown snapshot is missing", () => {
    // Given the fixture catalog contains the four required review comment shapes
    // And the stored markdown snapshots omit "assessment.golden.md"
    const availableGoldenFiles = PreviewGoldenCases.map(({ golden }) => golden).filter(
      (golden) => golden !== "assessment.golden.md",
    );

    // When the preview harness validates the catalog
    const result = validatePreviewFixtureCatalog(PreviewGoldenCases, availableGoldenFiles);

    // Then validation fails
    expect(result.ok).toBe(false);
    // And the failure names "assessment.golden.md"
    expect(result.missingGoldenFiles).toContain("assessment.golden.md");
  });

  it("renders inline finding suggestion and audit reference markup in its golden snapshot", () => {
    // Given the "inline finding" fixture contains a finding titled "Escape user-supplied HTML"
    // And the finding includes a committable suggestion block
    // And the finding includes audit reference "SOVRI-AC-AB12-CD34"
    const expectedMarkdown = loadTextFixture("inline-finding.golden.md");

    // When the preview harness renders markdown for "inline-finding.json"
    const markdown = renderPreviewFixtureMarkdown("inline-finding.json");

    // Then the rendered markdown contains a "suggestion" fenced block
    expect(markdown).toContain("```suggestion\n");
    // And the rendered markdown contains "SOVRI-AC-AB12-CD34"
    expect(markdown).toContain("SOVRI-AC-AB12-CD34");
    // And the rendered markdown equals "inline-finding.golden.md" byte-for-byte
    expect(markdown).toBe(expectedMarkdown);
  });
});

describe("preview HTML theme wrapper", () => {
  it.each(PreviewThemeCases)(
    "renders $theme root with $themeClass and without $otherThemeClass",
    ({ theme, themeClass, otherThemeClass }) => {
      // Given a preview section titled "Summary" with markdown "## Approve"
      // And a preview section titled "Inline finding" with markdown "Major: Escape user-supplied HTML"
      const sections = PreviewHtmlSections;

      // When renderPreviewHtml renders the sections with theme "<theme>"
      const html = getRenderPreviewHtml()({ sections, theme });

      const rootClasses = extractRootClasses(html);

      // Then the HTML root element has class "ghc"
      expect(rootClasses.has("ghc")).toBe(true);
      // And the HTML root element has class "<themeClass>"
      expect(rootClasses.has(themeClass)).toBe(true);
      // And the HTML root element does not have class "<otherThemeClass>"
      expect(rootClasses.has(otherThemeClass)).toBe(false);
    },
  );
});

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8").trimEnd();
}

function getRenderPreviewHtml(): RenderPreviewHtml {
  if (!hasRenderPreviewHtml(RenderPreviewModule)) {
    throw new MissingPreviewHtmlRendererError();
  }

  return RenderPreviewModule.renderPreviewHtml;
}

function hasRenderPreviewHtml(
  module: object,
): module is { readonly renderPreviewHtml: RenderPreviewHtml } {
  return "renderPreviewHtml" in module && typeof module.renderPreviewHtml === "function";
}

function extractRootClasses(html: string): ReadonlySet<string> {
  const rootClassAttribute = /^<[^>\s]+[^>]*\sclass="([^"]*)"/u.exec(html)?.[1];

  if (rootClassAttribute === undefined) {
    throw new MissingPreviewRootClassError();
  }

  return new Set(rootClassAttribute.split(/\s+/u).filter((className) => className.length > 0));
}

class MissingPreviewHtmlRendererError extends Error {
  public override readonly name = "MissingPreviewHtmlRendererError";

  public constructor() {
    super("renderPreviewHtml export is missing from the preview renderer");
  }
}

class MissingPreviewRootClassError extends Error {
  public override readonly name = "MissingPreviewRootClassError";

  public constructor() {
    super("preview HTML root element is missing a class attribute");
  }
}
