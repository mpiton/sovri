// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { z } from "zod";

const PreviewMarkdownFixtureSchema = z
  .object({
    markdown_lines: z.array(z.string()).min(1),
  })
  .strict();

type PreviewMarkdownFixture = z.infer<typeof PreviewMarkdownFixtureSchema>;

export function renderPreviewFixtureMarkdown(fixtureName: string): string {
  const fixture = loadPreviewMarkdownFixture(fixtureName);

  return fixture.markdown_lines.join("\n");
}

function loadPreviewMarkdownFixture(fixtureName: string): PreviewMarkdownFixture {
  return PreviewMarkdownFixtureSchema.parse(JSON.parse(loadTextFixture(fixtureName)));
}

function loadTextFixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}
