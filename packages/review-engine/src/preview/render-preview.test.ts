// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as RenderPreviewModule from "./render-preview.js";
import {
  type AssertPreviewGoldenMarkdownSnapshots,
  type AssertPreviewThemeRoot,
  PreviewMarkdownForbiddenFragments,
  type MatchesPreviewGoldenSnapshotBytes,
  type PreviewFixture,
  type PreviewGoldenMarkdownSnapshotSource,
  renderPreviewFixtureMarkdown,
  type ValidatePreviewGoldenMarkdownSnapshots,
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

interface PreviewDeterminismValidationResult {
  readonly ok: boolean;
  readonly volatileFragments: readonly string[];
}

interface PreviewFixtureAnonymizationViolation {
  readonly fixture: string;
  readonly reason: string;
  readonly value: string;
}

interface PreviewFixtureAnonymizationValidationResult {
  readonly ok: boolean;
  readonly repositoryNames: readonly string[];
  readonly authorLogins: readonly string[];
  readonly providerKeyValues: readonly string[];
  readonly violations: readonly PreviewFixtureAnonymizationViolation[];
}

interface PreviewRenderedOutputValidationResult {
  readonly ok: boolean;
  readonly forbiddenFragments: readonly string[];
}

type RenderPreviewHtml = (request: PreviewHtmlRequest) => string;
type ParsePreviewFixture = (fixture: unknown) => PreviewFixture;
type ParsePreviewFixtureJson = (fixtureJson: string) => PreviewFixture;
type RenderPreviewFixtureMarkdownTwice = (fixtureName: string) => readonly [string, string];
type BuildPreviewFixtureSections = (
  catalog: readonly PreviewGoldenCase[],
  fixtureFileNames: readonly string[],
) => readonly PreviewHtmlSection[];
type ValidatePreviewDeterminism = (renderedPreview: string) => PreviewDeterminismValidationResult;
type ValidatePreviewFixtureAnonymization = (
  fixtureName: string,
  fixture: unknown,
) => PreviewFixtureAnonymizationValidationResult;
type ValidatePreviewRenderedOutput = (
  renderedPreview: string,
) => PreviewRenderedOutputValidationResult;
type AssertPreviewDevOnlySurface = (publicExportNames: readonly string[]) => void;

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

interface PreviewForbiddenIdentityCase {
  readonly fixture: string;
  readonly forbiddenValue: string;
  readonly reason: string;
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

const PreviewForbiddenIdentityCases: readonly PreviewForbiddenIdentityCase[] = [
  {
    fixture: "summary.review.json",
    forbiddenValue: "ghp_1234567890abcdef1234567890abc",
    reason: "github token shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "github_pat_1234567890abcdef1234567890abcdef",
    reason: "github token shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "ghs_1234567890abcdef1234567890abc",
    reason: "github token shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "ghu_1234567890abcdef1234567890abc",
    reason: "github token shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "gho_1234567890abcdef1234567890abc",
    reason: "github token shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "ghr_1234567890abcdef1234567890abc",
    reason: "github token shape",
  },
  {
    fixture: "assessment.review.json",
    forbiddenValue: "sk-ant-api03-test",
    reason: "llm key shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "real-bank/payments-api",
    reason: "real repo shape",
  },
  {
    fixture: "provenance.review.json",
    forbiddenValue: "realbank/payments",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "Review for mpiton/sovri",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "Review for mpiton/sovri.",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "https://github.com/mpiton/sovri",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "https://github.com/mpiton/sovri.",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "https://www.github.com/mpiton/sovri",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "git://github.com/mpiton/sovri",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "https://github.com/mpiton/sovri%zz",
    reason: "real repo shape",
  },
  {
    fixture: "inline-finding.json",
    forbiddenValue: "Review for acme/docs",
    reason: "real repo shape",
  },
  {
    fixture: "provenance.review.json",
    forbiddenValue: "https://github.com/acme/tests",
    reason: "real repo shape",
  },
  {
    fixture: "summary.review.json",
    forbiddenValue: "See https://cwe.mitre.org/data/definitions/79.html before realbank/payments",
    reason: "real repo shape",
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

  it("passes golden validation without snapshot updates for unmodified fixtures", () => {
    // Given all four preview fixtures match their stored golden markdown
    const validateGoldenMarkdownSnapshots = getValidatePreviewGoldenMarkdownSnapshots();
    const assertGoldenMarkdownSnapshots = getAssertPreviewGoldenMarkdownSnapshots();

    // When render-preview.test.ts runs
    const result = validateGoldenMarkdownSnapshots(PreviewGoldenCases);

    // Then the test suite passes
    expect(result.ok).toBe(true);
    // And no snapshot update is required
    expect(result.requiredSnapshotUpdates).toEqual([]);
    // And real catalog drift would fail through the assertion path with named golden files
    expect(() => assertGoldenMarkdownSnapshots(PreviewGoldenCases)).not.toThrow();
  });

  it.each(PreviewGoldenCases)(
    "fails markdown drift for $fixture and names $golden",
    ({ fixture, golden }) => {
      // Given the generated markdown for "<fixture>" differs from "<golden>" by one heading
      const assertGoldenMarkdownSnapshots = getAssertPreviewGoldenMarkdownSnapshots();
      const snapshotSource = createHeadingDriftSnapshotSource(fixture);

      // When render-preview.test.ts runs
      const assertSnapshots = (): void =>
        assertGoldenMarkdownSnapshots(PreviewGoldenCases, snapshotSource);

      // Then the test suite fails
      // And the thrown error message contains "<golden>"
      expect(assertSnapshots).toThrow(golden);
    },
  );

  it("matches empty golden markdown bytes", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();

    expect(matchesSnapshotBytes("", "")).toBe(true);
  });

  it("detects missing final newline drift in golden markdown snapshots", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();

    expect(matchesSnapshotBytes("## Approve", "## Approve\n")).toBe(false);
  });

  it("matches exact golden markdown bytes with and without final newlines", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();

    expect(matchesSnapshotBytes("## Approve\n", "## Approve\n")).toBe(true);
    expect(matchesSnapshotBytes("## Approve", "## Approve")).toBe(true);
  });

  it("detects extra trailing whitespace drift in golden markdown snapshots", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();

    expect(matchesSnapshotBytes("## Approve", "## Approve\n\n")).toBe(false);
    expect(matchesSnapshotBytes("## Approve", "## Approve \n")).toBe(false);
  });

  it("preserves unicode golden markdown snapshot bytes", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();
    const unicodeMarkdown = "Cafe\u0301 review \u{2713}\n";

    expect(matchesSnapshotBytes(unicodeMarkdown, unicodeMarkdown)).toBe(true);
    expect(matchesSnapshotBytes(unicodeMarkdown, "Cafe review \u{2713}\n")).toBe(false);
  });

  it("compares long golden markdown snapshot bytes", () => {
    const matchesSnapshotBytes = getMatchesPreviewGoldenSnapshotBytes();
    const longMarkdown = `${"x".repeat(8192)}\n`;

    expect(matchesSnapshotBytes(longMarkdown, longMarkdown)).toBe(true);
    expect(matchesSnapshotBytes(longMarkdown, `${longMarkdown}x`)).toBe(false);
  });

  it("names missing golden snapshot helper exports with factory errors", () => {
    const missingValidatorError = missingPreviewRendererExportError(
      "MissingPreviewGoldenMarkdownValidatorExportError",
      "validatePreviewGoldenMarkdownSnapshots",
    );
    const missingMatcherError = missingPreviewRendererExportError(
      "MissingPreviewGoldenSnapshotMatcherExportError",
      "matchesPreviewGoldenSnapshotBytes",
    );

    expect(missingValidatorError).toBeInstanceOf(Error);
    expect(missingValidatorError.name).toBe("MissingPreviewGoldenMarkdownValidatorExportError");
    expect(missingValidatorError.message).toBe(
      "validatePreviewGoldenMarkdownSnapshots export is missing from the preview renderer",
    );
    expect(missingMatcherError).toBeInstanceOf(Error);
    expect(missingMatcherError.name).toBe("MissingPreviewGoldenSnapshotMatcherExportError");
    expect(missingMatcherError.message).toBe(
      "matchesPreviewGoldenSnapshotBytes export is missing from the preview renderer",
    );
  });

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

  it("validates fixture JSON through inferred preview schemas before rendering", () => {
    // Given the summary fixture is parsed from JSON
    const parsePreviewFixture = getParsePreviewFixture();
    const parsePreviewFixtureJson = getParsePreviewFixtureJson();
    const summaryFixture: PreviewFixture = parsePreviewFixtureJson(
      loadTextFixture("summary.review.json"),
    );

    // And the provenance fixture contains optional provenance data
    const provenanceFixture: PreviewFixture = parsePreviewFixture(
      JSON.parse(loadTextFixture("provenance.review.json")),
    );

    // When the preview harness loads the fixtures
    // Then Zod schemas validate the parsed fixture values
    expect(summaryFixture.kind).toBe("summary");
    if (summaryFixture.kind === "summary") {
      expect(summaryFixture.review.status).toBe("success");
      expect(summaryFixture.review.findings.length).toBeGreaterThan(0);
    }

    // And TypeScript types are inferred from those schemas
    expect(provenanceFixture.kind).toBe("provenance");
    if (provenanceFixture.kind === "provenance") {
      expect(provenanceFixture.provenance.promptSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(provenanceFixture.provenance.signedAuditEntry).toBeDefined();
    }

    // And malformed fixture JSON fails before rendering starts
    expect(() => parsePreviewFixtureJson("{")).toThrow(SyntaxError);
    expect(() =>
      parsePreviewFixture({
        kind: "provenance",
        findings: [],
        provenance: {
          llmProvider: "",
          llmModel: "test-model",
        },
      }),
    ).toThrow();
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

  it("rejects preview internals exported by the public package API", () => {
    // Given the package root exports "renderPreviewHtml"
    const publicExportNames = ["parseReviewDiff", "renderPreviewHtml"];

    // When the dev-only surface assertion runs
    const assertDevOnlySurface = (): void => getAssertPreviewDevOnlySurface()(publicExportNames);

    // Then validation fails
    // And the failure names "renderPreviewHtml"
    expect(assertDevOnlySurface).toThrow("renderPreviewHtml");
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

  it("rejects generated previews containing volatile generated_at bytes", () => {
    // Given a rendered preview contains "generated_at=2026-06-05T10:15:30.000Z"
    const renderedPreview = ["# Preview", "", "generated_at=2026-06-05T10:15:30.000Z"].join("\n");
    const validateDeterminism = getValidatePreviewDeterminism();

    // When the determinism assertion runs
    const result = validateDeterminism(renderedPreview);

    // Then validation fails
    expect(result.ok).toBe(false);
    // And the failure names "generated_at"
    expect(result.volatileFragments).toContain("generated_at");
  });
});

describe("preview fixture anonymization", () => {
  it.each(PreviewGoldenCases.map(({ fixture }) => fixture))(
    "validates placeholder identity values in %s",
    (fixture) => {
      // Given the "<fixture>" fixture is loaded
      const fixtureJson: unknown = JSON.parse(loadTextFixture(fixture));
      const validateAnonymization = getValidatePreviewFixtureAnonymization();

      // When the anonymization assertion inspects the fixture
      const result = validateAnonymization(fixture, fixtureJson);

      // Then every repository name is "example/review-target"
      expect(result.repositoryNames.every((name) => name === "example/review-target")).toBe(true);
      // And every author login starts with "test-"
      expect(result.authorLogins.every((login) => login.startsWith("test-"))).toBe(true);
      // And every provider key value is "test-key"
      expect(result.providerKeyValues.every((value) => value === "test-key")).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    },
  );

  it.each(PreviewForbiddenIdentityCases)(
    "rejects $reason in $fixture",
    ({ fixture, forbiddenValue, reason }) => {
      // Given the "<fixture>" fixture contains "<forbiddenValue>"
      const fixtureJson: unknown = JSON.parse(loadTextFixture(fixture));
      const fixtureWithForbiddenValue = injectFixtureString(fixtureJson, forbiddenValue);
      const validateAnonymization = getValidatePreviewFixtureAnonymization();

      // When the anonymization assertion inspects the fixture
      const result = validateAnonymization(fixture, fixtureWithForbiddenValue);

      // Then validation fails
      expect(result.ok).toBe(false);
      // And the failure names "<fixture>"
      expect(result.violations.some((violation) => violation.fixture === fixture)).toBe(true);
      // And the failure reports "<reason>"
      expect(result.violations).toContainEqual({ fixture, reason, value: forbiddenValue });
    },
  );

  it("ignores repository-looking paths inside non-GitHub URLs", () => {
    const fixture = "summary.review.json";
    const fixtureJson: unknown = JSON.parse(loadTextFixture(fixture));
    const fixtureWithNonGithubUrl = injectFixtureString(
      fixtureJson,
      "https://evil.example/github.com/mpiton/sovri",
    );

    const result = getValidatePreviewFixtureAnonymization()(fixture, fixtureWithNonGithubUrl);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("ignores GitHub URLs with invalid repository owner length", () => {
    const fixture = "summary.review.json";
    const fixtureJson: unknown = JSON.parse(loadTextFixture(fixture));
    const fixtureWithInvalidOwner = injectFixtureString(
      fixtureJson,
      "https://github.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/repo",
    );

    const result = getValidatePreviewFixtureAnonymization()(fixture, fixtureWithInvalidOwner);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("accepts placeholder provider keys without rendering them", () => {
    // Given the provenance fixture contains provider key "test-key"
    const fixture = "provenance.review.json";
    const fixtureJson: unknown = JSON.parse(loadTextFixture(fixture));
    const validateAnonymization = getValidatePreviewFixtureAnonymization();

    // When the preview harness renders the provenance markdown
    const markdown = renderPreviewFixtureMarkdown(fixture);
    const result = validateAnonymization(fixture, fixtureJson);

    // Then the rendered markdown does not contain "test-key"
    expect(markdown).not.toContain("test-key");
    // And the fixture scan treats "test-key" as an allowed placeholder
    expect(result.providerKeyValues).toContain("test-key");
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
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
      // And the wrapper assertion accepts the rendered root for "<theme>"
      expect(() => getAssertPreviewThemeRoot()(theme, [...rootClasses].join(" "))).not.toThrow();
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

  it("fails dark wrapper theme drift with the affected theme name", () => {
    // Given renderPreviewHtml renders a dark preview root without class "gh-dark"
    const html = getRenderPreviewHtml()({ sections: PreviewHtmlSections, theme: "dark" });
    const rootClasses = [...extractRootClasses(html)]
      .filter((className) => className !== "gh-dark")
      .join(" ");

    // When the wrapper assertion runs
    const assertWrapperTheme = (): void => getAssertPreviewThemeRoot()("dark", rootClasses);

    // Then the test suite fails
    // And the thrown error message contains "dark"
    expect(assertWrapperTheme).toThrow("dark");
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

  it("keeps generated light and dark outputs free of tokens and raw webhook payloads", () => {
    // Given the fixture catalog uses only placeholder identity data
    const sections = buildPreviewPayloadSections();
    const validateRenderedOutput = getValidatePreviewRenderedOutput();

    for (const theme of ["light", "dark"] satisfies readonly PreviewTheme[]) {
      // When the preview script writes both theme outputs
      const html = getRenderPreviewHtml()({ sections, theme });
      const result = validateRenderedOutput(html);

      // Then no output contains "ghp_"
      expect(html).not.toContain("ghp_");
      // And no output contains "sk-ant-"
      expect(html).not.toContain("sk-ant-");
      // And no output contains "x-hub-signature-256"
      expect(html).not.toContain("x-hub-signature-256");
      // And no output contains a raw GitHub webhook payload body
      expect(result.ok).toBe(true);
      expect(result.forbiddenFragments).toEqual([]);
    }
  });

  it.each([
    { output: "token ghp_1234567890abcdef", fragment: "ghp_" },
    { output: "token gho_1234567890abcdef", fragment: "gho_" },
    { output: "token ghu_1234567890abcdef", fragment: "ghu_" },
    { output: "token ghs_1234567890abcdef", fragment: "ghs_" },
    { output: "token ghr_1234567890abcdef", fragment: "ghr_" },
    { output: "token github_pat_1234567890abcdef", fragment: "github_pat_" },
    { output: "key sk-ant-api03-test", fragment: "sk-ant-" },
    { output: "header x-hub-signature-256=sha256:test", fragment: "x-hub-signature-256" },
    {
      output:
        '{"action":"opened","pull_request":{"number":1},"repository":{"full_name":"example/review-target"},"sender":{"login":"test-author"}}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        "{&quot;action&quot;:&quot;opened&quot;,&quot;pull_request&quot;:{},&quot;repository&quot;:{},&quot;sender&quot;:{}}",
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        "{&amp;quot;action&amp;quot;:&amp;quot;opened&amp;quot;,&amp;quot;pull_request&amp;quot;:{},&amp;quot;repository&amp;quot;:{},&amp;quot;sender&amp;quot;:{}}",
      fragment: "raw GitHub webhook payload body",
    },
    {
      output: '{"action":"opened","pull_request":{"title":"done}"},"repository":{},"sender":{}}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output: 'before "x {"action":"opened","pull_request":{},"repository":{},"sender":{}}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        '{"body":{"action":"opened","pull_request":{},"repository":{},"sender":{}},"logged_at":"now"}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output: '{"note":"oops {"action":"opened","pull_request":{},"repository":{},"sender":{}}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output: '{"action":"created","issue":{},"comment":{},"repository":{},"sender":{}}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        '{"body":"{\\"action\\":\\"opened\\",\\"pull_request\\":{},\\"repository\\":{},\\"sender\\":{}}"}',
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        "{&#x22;action&#x22;:&#x22;opened&#x22;,&#x22;pull_request&#x22;:{},&#x22;repository&#x22;:{},&#x22;sender&#x22;:{}}",
      fragment: "raw GitHub webhook payload body",
    },
    {
      output:
        "{&amp;#x22;action&amp;#x22;:&amp;#x22;opened&amp;#x22;,&amp;#x22;pull_request&amp;#x22;:{},&amp;#x22;repository&amp;#x22;:{},&amp;#x22;sender&amp;#x22;:{}}",
      fragment: "raw GitHub webhook payload body",
    },
  ])("rejects rendered output containing $fragment", ({ output, fragment }) => {
    const result = getValidatePreviewRenderedOutput()(output);

    expect(result.ok).toBe(false);
    expect(result.forbiddenFragments).toContain(fragment);
  });

  it("accepts prose naming webhook fields without a raw JSON payload body", () => {
    const output = "Webhook fields: action, pull_request, repository, sender.";
    const result = getValidatePreviewRenderedOutput()(output);

    expect(result.ok).toBe(true);
    expect(result.forbiddenFragments).toEqual([]);
  });
});

function loadTextFixture(name: string): string {
  // Preserve trailing fixture bytes so snapshot drift checks can detect whitespace changes.
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

function getRenderPreviewHtml(): RenderPreviewHtml {
  if (!hasRenderPreviewHtml(RenderPreviewModule)) {
    throw missingPreviewRendererExportError("MissingPreviewHtmlRendererError", "renderPreviewHtml");
  }

  return RenderPreviewModule.renderPreviewHtml;
}

function hasRenderPreviewHtml(
  module: object,
): module is { readonly renderPreviewHtml: RenderPreviewHtml } {
  return "renderPreviewHtml" in module && typeof module.renderPreviewHtml === "function";
}

function getParsePreviewFixture(): ParsePreviewFixture {
  if (!hasParsePreviewFixture(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewFixtureParserError",
      "parsePreviewFixture",
    );
  }

  return RenderPreviewModule.parsePreviewFixture;
}

function hasParsePreviewFixture(
  module: object,
): module is { readonly parsePreviewFixture: ParsePreviewFixture } {
  return "parsePreviewFixture" in module && typeof module.parsePreviewFixture === "function";
}

function getParsePreviewFixtureJson(): ParsePreviewFixtureJson {
  if (!hasParsePreviewFixtureJson(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewFixtureJsonParserError",
      "parsePreviewFixtureJson",
    );
  }

  return RenderPreviewModule.parsePreviewFixtureJson;
}

function hasParsePreviewFixtureJson(
  module: object,
): module is { readonly parsePreviewFixtureJson: ParsePreviewFixtureJson } {
  return (
    "parsePreviewFixtureJson" in module && typeof module.parsePreviewFixtureJson === "function"
  );
}

function getRenderPreviewFixtureMarkdownTwice(): RenderPreviewFixtureMarkdownTwice {
  if (!hasRenderPreviewFixtureMarkdownTwice(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewFixtureDeterminismRendererError",
      "renderPreviewFixtureMarkdownTwice",
    );
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

function getValidatePreviewGoldenMarkdownSnapshots(): ValidatePreviewGoldenMarkdownSnapshots {
  if (!hasValidatePreviewGoldenMarkdownSnapshots(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewGoldenMarkdownValidatorExportError",
      "validatePreviewGoldenMarkdownSnapshots",
    );
  }

  return RenderPreviewModule.validatePreviewGoldenMarkdownSnapshots;
}

function hasValidatePreviewGoldenMarkdownSnapshots(module: object): module is {
  readonly validatePreviewGoldenMarkdownSnapshots: ValidatePreviewGoldenMarkdownSnapshots;
} {
  return (
    "validatePreviewGoldenMarkdownSnapshots" in module &&
    typeof module.validatePreviewGoldenMarkdownSnapshots === "function"
  );
}

function getAssertPreviewGoldenMarkdownSnapshots(): AssertPreviewGoldenMarkdownSnapshots {
  if (!hasAssertPreviewGoldenMarkdownSnapshots(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewGoldenMarkdownSnapshotAssertionExportError",
      "assertPreviewGoldenMarkdownSnapshots",
    );
  }

  return RenderPreviewModule.assertPreviewGoldenMarkdownSnapshots;
}

function hasAssertPreviewGoldenMarkdownSnapshots(module: object): module is {
  readonly assertPreviewGoldenMarkdownSnapshots: AssertPreviewGoldenMarkdownSnapshots;
} {
  return (
    "assertPreviewGoldenMarkdownSnapshots" in module &&
    typeof module.assertPreviewGoldenMarkdownSnapshots === "function"
  );
}

function getMatchesPreviewGoldenSnapshotBytes(): MatchesPreviewGoldenSnapshotBytes {
  if (!hasMatchesPreviewGoldenSnapshotBytes(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewGoldenSnapshotMatcherExportError",
      "matchesPreviewGoldenSnapshotBytes",
    );
  }

  return RenderPreviewModule.matchesPreviewGoldenSnapshotBytes;
}

function hasMatchesPreviewGoldenSnapshotBytes(module: object): module is {
  readonly matchesPreviewGoldenSnapshotBytes: MatchesPreviewGoldenSnapshotBytes;
} {
  return (
    "matchesPreviewGoldenSnapshotBytes" in module &&
    typeof module.matchesPreviewGoldenSnapshotBytes === "function"
  );
}

function getBuildPreviewFixtureSections(): BuildPreviewFixtureSections {
  if (!hasBuildPreviewFixtureSections(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewFixtureSectionBuilderError",
      "buildPreviewFixtureSections",
    );
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

function getValidatePreviewDeterminism(): ValidatePreviewDeterminism {
  if (!hasValidatePreviewDeterminism(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewDeterminismValidatorError",
      "validatePreviewDeterminism",
    );
  }

  return RenderPreviewModule.validatePreviewDeterminism;
}

function hasValidatePreviewDeterminism(module: object): module is {
  readonly validatePreviewDeterminism: ValidatePreviewDeterminism;
} {
  return (
    "validatePreviewDeterminism" in module &&
    typeof module.validatePreviewDeterminism === "function"
  );
}

function getValidatePreviewFixtureAnonymization(): ValidatePreviewFixtureAnonymization {
  if (!hasValidatePreviewFixtureAnonymization(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewFixtureAnonymizationValidatorError",
      "validatePreviewFixtureAnonymization",
    );
  }

  return RenderPreviewModule.validatePreviewFixtureAnonymization;
}

function hasValidatePreviewFixtureAnonymization(module: object): module is {
  readonly validatePreviewFixtureAnonymization: ValidatePreviewFixtureAnonymization;
} {
  return (
    "validatePreviewFixtureAnonymization" in module &&
    typeof module.validatePreviewFixtureAnonymization === "function"
  );
}

function getValidatePreviewRenderedOutput(): ValidatePreviewRenderedOutput {
  if (!hasValidatePreviewRenderedOutput(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewRenderedOutputValidatorError",
      "validatePreviewRenderedOutput",
    );
  }

  return RenderPreviewModule.validatePreviewRenderedOutput;
}

function hasValidatePreviewRenderedOutput(module: object): module is {
  readonly validatePreviewRenderedOutput: ValidatePreviewRenderedOutput;
} {
  return (
    "validatePreviewRenderedOutput" in module &&
    typeof module.validatePreviewRenderedOutput === "function"
  );
}

function getAssertPreviewDevOnlySurface(): AssertPreviewDevOnlySurface {
  if (!hasAssertPreviewDevOnlySurface(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewDevOnlySurfaceAssertionError",
      "assertPreviewDevOnlySurface",
    );
  }

  return RenderPreviewModule.assertPreviewDevOnlySurface;
}

function hasAssertPreviewDevOnlySurface(module: object): module is {
  readonly assertPreviewDevOnlySurface: AssertPreviewDevOnlySurface;
} {
  return (
    "assertPreviewDevOnlySurface" in module &&
    typeof module.assertPreviewDevOnlySurface === "function"
  );
}

function getValidatePreviewThemeRoot(): ValidatePreviewThemeRoot {
  if (!hasValidatePreviewThemeRoot(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewThemeRootValidatorError",
      "validatePreviewThemeRoot",
    );
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

function getAssertPreviewThemeRoot(): AssertPreviewThemeRoot {
  if (!hasAssertPreviewThemeRoot(RenderPreviewModule)) {
    throw missingPreviewRendererExportError(
      "MissingPreviewThemeRootAssertionExportError",
      "assertPreviewThemeRoot",
    );
  }

  return RenderPreviewModule.assertPreviewThemeRoot;
}

function hasAssertPreviewThemeRoot(
  module: object,
): module is { readonly assertPreviewThemeRoot: AssertPreviewThemeRoot } {
  return "assertPreviewThemeRoot" in module && typeof module.assertPreviewThemeRoot === "function";
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

function createHeadingDriftSnapshotSource(
  targetFixture: string,
): PreviewGoldenMarkdownSnapshotSource {
  return {
    renderFixtureMarkdown: (fixtureName) => {
      const markdown = renderPreviewFixtureMarkdown(fixtureName);

      return fixtureName === targetFixture ? driftFirstMarkdownHeading(markdown) : markdown;
    },
    loadGoldenMarkdown: loadTextFixture,
  };
}

function driftFirstMarkdownHeading(markdown: string): string {
  const headingMatch = /^(#{1,6}\s+.+)$/mu.exec(markdown);
  const heading = headingMatch?.[1];

  if (heading === undefined) {
    return `## Drifted preview heading\n${markdown}`;
  }

  return markdown.replace(heading, `${heading} drift`);
}

function injectFixtureString(fixture: unknown, value: string): unknown {
  if (!isJsonFixtureContainer(fixture)) {
    throw new InvalidPreviewFixtureInjectionError();
  }

  return {
    fixture,
    injected_fixture_values: [value],
  };
}

function isJsonFixtureContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
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

type MissingPreviewRendererExportErrorName =
  | "MissingPreviewHtmlRendererError"
  | "MissingPreviewFixtureParserError"
  | "MissingPreviewFixtureJsonParserError"
  | "MissingPreviewFixtureDeterminismRendererError"
  | "MissingPreviewGoldenMarkdownValidatorExportError"
  | "MissingPreviewGoldenMarkdownSnapshotAssertionExportError"
  | "MissingPreviewGoldenSnapshotMatcherExportError"
  | "MissingPreviewFixtureSectionBuilderError"
  | "MissingPreviewDeterminismValidatorError"
  | "MissingPreviewFixtureAnonymizationValidatorError"
  | "MissingPreviewDevOnlySurfaceAssertionError"
  | "MissingPreviewThemeRootValidatorError"
  | "MissingPreviewThemeRootAssertionExportError";

interface MissingPreviewRendererExportErrorDetails {
  readonly errorName: MissingPreviewRendererExportErrorName;
  readonly exportName: string;
}

class MissingPreviewRendererExportError extends Error {
  public override readonly name: MissingPreviewRendererExportErrorName;

  public constructor({ errorName, exportName }: MissingPreviewRendererExportErrorDetails) {
    super(`${exportName} export is missing from the preview renderer`);
    this.name = errorName;
  }
}

function missingPreviewRendererExportError(
  errorName: MissingPreviewRendererExportErrorName,
  exportName: string,
): MissingPreviewRendererExportError {
  return new MissingPreviewRendererExportError({ errorName, exportName });
}

class MissingPreviewRootClassError extends Error {
  public override readonly name = "MissingPreviewRootClassError";

  public constructor() {
    super("preview HTML root element is missing a class attribute");
  }
}

class MissingPreviewStyleElementError extends Error {
  public override readonly name = "MissingPreviewStyleElementError";

  public constructor() {
    super("preview HTML wrapper is missing a style element");
  }
}

class InvalidPreviewFixtureInjectionError extends Error {
  public override readonly name = "InvalidPreviewFixtureInjectionError";

  public constructor() {
    super("preview fixture injection requires parsed JSON object or array input");
  }
}
