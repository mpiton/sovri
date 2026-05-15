// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

export const WalkthroughInputSchema = z.strictObject({
  summary: z.string().min(1),
  findingCount: z.number().int().nonnegative(),
});

export type WalkthroughInput = z.input<typeof WalkthroughInputSchema>;

export function composeWalkthrough(input: WalkthroughInput): string {
  const walkthrough = WalkthroughInputSchema.parse(input);
  const findingLabel = walkthrough.findingCount === 1 ? "finding" : "findings";

  return [
    "## Sovri review",
    "",
    walkthrough.summary,
    "",
    `Detected ${walkthrough.findingCount} ${findingLabel}.`,
  ].join("\n");
}
