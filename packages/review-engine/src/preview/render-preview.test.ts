// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderPreviewFixtureMarkdown, validatePreviewFixtureCatalog } from "./render-preview.js";

interface PreviewGoldenCase {
  readonly shape: string;
  readonly fixture: string;
  readonly golden: string;
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
});

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8").trimEnd();
}
