// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { SovriConfigSchema } from "./SovriConfig.js";

// Rule R-01: review.mode accepts "compliance" and defaults to "compliance" when omitted.
// Acceptance scenarios mirror
//   specs/mat-78-config-review-mode-compliance-only/r01-accept-compliance-and-default.feature.

// Background: a .sovri.yml with a valid llm block
//   llm:
//     provider: mistral
//     model: mistral-large-latest
//     apiKeySecret: MISTRAL_API_KEY
const llm = {
  provider: "mistral",
  model: "mistral-large-latest",
  apiKeySecret: "MISTRAL_API_KEY",
} as const;

describe("R-01 — review.mode accepts compliance and defaults to compliance", () => {
  // @nominal
  // Scenario: Explicit compliance mode parses successfully
  //   Given the review block sets "mode: compliance"
  //   When the configuration is parsed by SovriConfigSchema
  //   Then parsing succeeds
  //   And the resolved review.mode is "compliance"
  it("parses an explicit review.mode of compliance", () => {
    const result = SovriConfigSchema.safeParse({ llm, review: { mode: "compliance" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.mode).toBe("compliance");
    }
  });

  // @nominal
  // Scenario: Omitting mode inside a present review block defaults to compliance
  //   Given the review block sets "severityThreshold: major" and omits "mode"
  //   When the configuration is parsed by SovriConfigSchema
  //   Then parsing succeeds
  //   And the resolved review.mode is "compliance"
  it("defaults review.mode to compliance when omitted inside a present review block", () => {
    const result = SovriConfigSchema.safeParse({ llm, review: { severityThreshold: "major" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.mode).toBe("compliance");
    }
  });

  // @nominal
  // Scenario: Omitting the whole review block defaults mode to compliance
  //   Given the .sovri.yml has no review block
  //   When the configuration is parsed by SovriConfigSchema
  //   Then parsing succeeds
  //   And the resolved review.mode is "compliance"
  it("defaults review.mode to compliance when the whole review block is omitted", () => {
    const result = SovriConfigSchema.safeParse({ llm });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.mode).toBe("compliance");
    }
  });
});
