// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as RenderPreviewModule from "./render-preview.js";
import {
  PreviewMarkdownForbiddenFragments,
  renderPreviewFixtureMarkdown,
  validatePreviewFixtureCatalog,
  validatePreviewMarkdownPayload,
} from "./render-preview.js";

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
type RenderPreviewFixtureMarkdownTwice = (fixtureName: string) => readonly [string, string];
type BuildPreviewFixtureSections = (
  catalog: readonly PreviewGoldenCase[],
  fixtureFileNames: readonly string[],
) => readonly PreviewHtmlSection[];

interface PreviewThemeRootValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

type ValidatePreviewThemeRoot = (rootClasses: string) => PreviewThemeRootValidationResult;

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

  it.each(PreviewGoldenCases)(
    "validates $golden without CSS-only payload fragments",
    ({ golden }) => {
      // Given the stored markdown snapshot is "<golden>"
      const markdown = loadTextFixture(golden);

      // When the preview harness validates the markdown payload
      const result = validatePreviewMarkdownPayload(markdown);

      // Then the markdown does not contain "class="
      // And the markdown does not contain "style="
      // And the markdown does not contain "<style>"
      // And the markdown does not contain "gh-chrome"
      for (const fragment of PreviewMarkdownForbiddenFragments) {
        expect(markdown).not.toContain(fragment);
        expect(result.forbiddenFragments).not.toContain(fragment);
      }
      expect(result.ok).toBe(true);
      expect(result.forbiddenFragments).toEqual([]);
    },
  );

  it("rejects markdown containing preview chrome stylesheet fragments", () => {
    // Given markdown includes CSS copied from the preview HTML wrapper stylesheet
    const markdown = [
      ".ghc { display: block; }",
      ".gh-light { color-scheme: light; }",
      ".gh-dark { color-scheme: dark; }",
    ].join("\n");

    // When the preview harness validates the markdown payload
    const result = validatePreviewMarkdownPayload(markdown);

    // Then validation fails and reports the wrapper stylesheet fragments
    expect(result.ok).toBe(false);
    expect(result.forbiddenFragments).toEqual([
      ".ghc { display: block; }",
      ".gh-light { color-scheme: light; }",
      ".gh-dark { color-scheme: dark; }",
    ]);
  });

  it("keeps user-authored style tags inert in rendered summary markdown", () => {
    // Given the summary fixture contains the finding body "<style>.ghc{display:none}</style>"
    const fixtureText = loadTextFixture("summary.review.json");
    expect(fixtureText).toContain('"body": "<style>.ghc{display:none}</style>"');

    // When the preview harness renders markdown for the summary fixture
    const markdown = renderPreviewFixtureMarkdown("summary.review.json");

    // Then the rendered markdown contains "&lt;style&gt;.ghc{display:none}&lt;/style&gt;"
    expect(markdown).toContain("&lt;style&gt;.ghc{display:none}&lt;/style&gt;");
    // And the rendered markdown does not contain "<style>.ghc{display:none}</style>"
    expect(markdown).not.toContain("<style>.ghc{display:none}</style>");

    const html = getRenderPreviewHtml()({
      sections: [{ title: "Summary", markdown }],
      theme: "light",
    });

    // And the HTML wrapper still contains exactly one trusted style element
    expect(countOccurrences(html, "<style>")).toBe(1);
    expect(html).not.toContain("<style>.ghc{display:none}</style>");
  });
});

describe("preview markdown deterministic rendering", () => {
  it.each(PreviewGoldenCases)(
    "renders $shape fixture twice with identical bytes",
    ({ fixture }) => {
      // Given the "<shape>" fixture is loaded once
      const renderTwice = getRenderPreviewFixtureMarkdownTwice();

      // When the preview harness renders markdown for the fixture twice in the same process
      const [firstMarkdown, secondMarkdown] = renderTwice(fixture);

      // Then the first rendered markdown equals the second rendered markdown byte-for-byte
      expect(secondMarkdown).toBe(firstMarkdown);
    },
  );

  it("keeps preview sections in explicit catalog order when filesystem order is reversed", () => {
    // Given the filesystem lists fixture files in reverse lexical order
    const reverseLexicalFixtureFiles = PreviewGoldenCases.map(({ fixture }) => fixture).toSorted(
      (left, right) => right.localeCompare(left),
    );
    const catalogOrderFixtureFiles = PreviewGoldenCases.map(({ fixture }) => fixture);
    const buildSections = getBuildPreviewFixtureSections();

    // When the preview script builds the preview sections
    const sections = buildSections(PreviewGoldenCases, reverseLexicalFixtureFiles);

    // Then the generated sections are ordered as "summary", "assessment", "inline finding", "compliance provenance"
    expect(sections.map(({ title }) => title)).toEqual([
      "summary",
      "assessment",
      "inline finding",
      "compliance provenance",
    ]);

    // And the output does not depend on directory iteration order
    const catalogOrderSections = buildSections(PreviewGoldenCases, catalogOrderFixtureFiles);
    expect(serializeMarkdownPayload(sections)).toBe(serializeMarkdownPayload(catalogOrderSections));
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

  it("changes only the root theme class between light and dark output", () => {
    // Given a preview section titled "Summary" with markdown "## Approve"
    // And a preview section titled "Inline finding" with markdown "Major: Escape user-supplied HTML"
    const sections = PreviewHtmlSections;

    // When renderPreviewHtml renders the same sections with theme "light"
    const lightHtml = getRenderPreviewHtml()({ sections, theme: "light" });
    // And renderPreviewHtml renders the same sections with theme "dark"
    const darkHtml = getRenderPreviewHtml()({ sections, theme: "dark" });

    // Then replacing "gh-light" with "gh-dark" in the light HTML yields the dark HTML
    const normalizedLightHtml = lightHtml.replace("gh-light", "gh-dark");
    expect(normalizedLightHtml).toBe(darkHtml);
    // And no other byte differs between the two outputs
    expect(
      [...normalizedLightHtml].findIndex((character, index) => character !== darkHtml[index]),
    ).toBe(-1);
  });

  it("rejects a root carrying both light and dark theme classes", () => {
    // Given a rendered preview root has classes "ghc gh-light gh-dark"
    const rootClasses = "ghc gh-light gh-dark";

    // When the theme wrapper assertion runs
    const result = getValidatePreviewThemeRoot()(rootClasses);

    // Then validation fails
    expect(result.ok).toBe(false);
    // And the failure names "theme root"
    expect(result.error).toContain("theme root");
  });

  it("inlines the local preview stylesheet without changing markdown payload sections", () => {
    // Given the rendered markdown payload contains the summary, assessment, inline finding, and provenance shapes
    const sections = buildPreviewPayloadSections();
    const markdownPayload = serializeMarkdownPayload(sections);

    // When renderPreviewHtml renders the payload with theme "light"
    const html = getRenderPreviewHtml()({ sections, theme: "light" });

    // Then the HTML contains exactly one "<style>" element
    expect(countOccurrences(html, "<style>")).toBe(1);
    const styleElementText = extractStyleElementText(html);
    // And the style element contains the ".ghc" selector
    expect(styleElementText).toContain(".ghc");
    // And the style element contains the ".gh-light" selector
    expect(styleElementText).toContain(".gh-light");
    // And the rendered markdown payload remains unchanged
    expect(serializeMarkdownPayload(sections)).toBe(markdownPayload);
  });
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

function getRenderPreviewFixtureMarkdownTwice(): RenderPreviewFixtureMarkdownTwice {
  if (!hasRenderPreviewFixtureMarkdownTwice(RenderPreviewModule)) {
    throw new MissingPreviewFixtureDeterminismRendererError();
  }

  return RenderPreviewModule.renderPreviewFixtureMarkdownTwice;
}

function hasRenderPreviewFixtureMarkdownTwice(module: object): module is {
  readonly renderPreviewFixtureMarkdownTwice: RenderPreviewFixtureMarkdownTwice;
} {
  return (
    "renderPreviewFixtureMarkdownTwice" in module &&
    typeof module.renderPreviewFixtureMarkdownTwice === "function"
  );
}

function getBuildPreviewFixtureSections(): BuildPreviewFixtureSections {
  if (!hasBuildPreviewFixtureSections(RenderPreviewModule)) {
    throw new MissingPreviewFixtureSectionBuilderError();
  }

  return RenderPreviewModule.buildPreviewFixtureSections;
}

function hasBuildPreviewFixtureSections(module: object): module is {
  readonly buildPreviewFixtureSections: BuildPreviewFixtureSections;
} {
  return (
    "buildPreviewFixtureSections" in module &&
    typeof module.buildPreviewFixtureSections === "function"
  );
}

function getValidatePreviewThemeRoot(): ValidatePreviewThemeRoot {
  if (!hasValidatePreviewThemeRoot(RenderPreviewModule)) {
    throw new MissingPreviewThemeRootValidatorError();
  }

  return RenderPreviewModule.validatePreviewThemeRoot;
}

function hasValidatePreviewThemeRoot(
  module: object,
): module is { readonly validatePreviewThemeRoot: ValidatePreviewThemeRoot } {
  return (
    "validatePreviewThemeRoot" in module && typeof module.validatePreviewThemeRoot === "function"
  );
}

function buildPreviewPayloadSections(): readonly PreviewHtmlSection[] {
  return PreviewGoldenCases.map(({ shape, fixture }) => ({
    title: shape,
    markdown: renderPreviewFixtureMarkdown(fixture),
  }));
}

function serializeMarkdownPayload(sections: readonly PreviewHtmlSection[]): string {
  return sections.map((section) => section.markdown).join("\n\n---\n\n");
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let startIndex = value.indexOf(needle);

  while (startIndex !== -1) {
    count += 1;
    startIndex = value.indexOf(needle, startIndex + needle.length);
  }

  return count;
}

function extractStyleElementText(html: string): string {
  const styleElementText = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1];

  if (styleElementText === undefined) {
    throw new MissingPreviewStyleElementError();
  }

  return styleElementText;
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

class MissingPreviewFixtureDeterminismRendererError extends Error {
  public override readonly name = "MissingPreviewFixtureDeterminismRendererError";

  public constructor() {
    super("renderPreviewFixtureMarkdownTwice export is missing from the preview renderer");
  }
}

class MissingPreviewFixtureSectionBuilderError extends Error {
  public override readonly name = "MissingPreviewFixtureSectionBuilderError";

  public constructor() {
    super("buildPreviewFixtureSections export is missing from the preview renderer");
  }
}

class MissingPreviewThemeRootValidatorError extends Error {
  public override readonly name = "MissingPreviewThemeRootValidatorError";

  public constructor() {
    super("validatePreviewThemeRoot export is missing from the preview renderer");
  }
}

class MissingPreviewStyleElementError extends Error {
  public override readonly name = "MissingPreviewStyleElementError";

  public constructor() {
    super("preview HTML wrapper is missing a style element");
  }
}
