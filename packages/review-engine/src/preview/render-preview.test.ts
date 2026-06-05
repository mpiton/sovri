// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    async ({ fixture, golden }) => {
      // Given the "<shape>" fixture is loaded from "<fixture>"
      const { renderPreviewFixtureMarkdown } = await import("./render-preview.js");

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
});

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8").trimEnd();
}
