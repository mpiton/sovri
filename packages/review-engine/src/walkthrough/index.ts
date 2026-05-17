// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { ReviewSchema } from "@sovri/core";
import type { z } from "zod";

export const WalkthroughInputSchema = ReviewSchema;

export type WalkthroughInput = z.input<typeof WalkthroughInputSchema>;

export function composeWalkthrough(input: WalkthroughInput): string {
  const review = WalkthroughInputSchema.parse(input);

  return [
    "## Sovri review",
    "",
    review.summary,
    "",
    "### Findings",
    "",
    ...review.findings.map((finding) => `- ${finding.title}`),
  ].join("\n");
}
