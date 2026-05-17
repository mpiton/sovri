// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema } from "@sovri/core";
import type { z } from "zod";

import { formatMarkdownText } from "./markdown.js";
import { renderFiles, renderFindings, sortFindings } from "./sections.js";

export const WalkthroughInputSchema = ReviewSchema;

export type WalkthroughInput = z.input<typeof WalkthroughInputSchema>;

export function composeWalkthrough(input: unknown): string {
  const review = WalkthroughInputSchema.parse(input);
  const findings = sortFindings(review.findings);

  return [
    "## Sovri review",
    "",
    "### TL;DR",
    "",
    formatMarkdownText(review.summary.trim().length > 0 ? review.summary : "No summary provided."),
    "",
    "### Findings",
    "",
    ...renderFindings(findings),
    "",
    "### File-by-file",
    "",
    ...renderFiles(findings),
  ].join("\n");
}
