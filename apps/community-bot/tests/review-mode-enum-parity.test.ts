// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { ReviewModeSchema, SovriConfigSchema } from "@sovri/config";
import { ReviewPromptModeSchema, ReviewPullRequestConfigModeSchema } from "@sovri/review-engine";

// Rule R-04: @sovri/config and @sovri/review-engine allow and default the exact same
// review.mode value, so a config the parser accepts can never produce a mode the engine
// rejects. Mirrors
//   specs/mat-78-config-review-mode-compliance-only/r04-enum-parity.feature.

const minimalConfig = {
  llm: {
    provider: "mistral",
    model: "mistral-large-latest",
    apiKeySecret: "MISTRAL_API_KEY",
  },
} as const;

describe("R-04 — review.mode enum parity between config and the review engine", () => {
  // @nominal
  // Scenario: Both packages accept "compliance" and default to it
  it("accepts compliance and resolves the default to compliance across both packages", () => {
    expect(ReviewModeSchema.safeParse("compliance").success).toBe(true);
    expect(SovriConfigSchema.parse(minimalConfig).review.mode).toBe("compliance");
    expect(ReviewPromptModeSchema.safeParse("compliance").success).toBe(true);
    expect(ReviewPullRequestConfigModeSchema.safeParse("compliance").success).toBe(true);
  });

  // @nominal — the three enums expose exactly the same single allowed value.
  it("exposes the identical single allowed value in all three schemas", () => {
    expect(ReviewModeSchema.options).toEqual(["compliance"]);
    expect(ReviewPromptModeSchema.options).toEqual(["compliance"]);
    expect(ReviewPullRequestConfigModeSchema.options).toEqual(["compliance"]);
  });

  // @violation
  // Scenario Outline: Both packages reject every removed legacy value identically
  it.each(["full", "bugs-only", "strict", "minimal"])(
    "rejects legacy value %j in all three schemas",
    (legacy) => {
      expect(ReviewModeSchema.safeParse(legacy).success).toBe(false);
      expect(ReviewPromptModeSchema.safeParse(legacy).success).toBe(false);
      expect(ReviewPullRequestConfigModeSchema.safeParse(legacy).success).toBe(false);
    },
  );
});
