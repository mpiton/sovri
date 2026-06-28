// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { describe, expect, it } from "vitest";

import { SovriConfigValidationError } from "../errors.js";
import { parseConfigContent } from "../loader.js";

// Rule R-02: a .sovri.yml setting review.mode to a removed legacy value is rejected
// with a typed SovriConfigValidationError at review.mode. Mirrors
//   specs/mat-78-config-review-mode-compliance-only/r02-reject-legacy-modes.feature.

// Background: a .sovri.yml with a valid llm block.
function sovriYml(mode: string): string {
  return [
    "llm:",
    "  provider: mistral",
    "  model: mistral-large-latest",
    "  apiKeySecret: MISTRAL_API_KEY",
    "review:",
    `  mode: ${mode}`,
  ].join("\n");
}

describe("R-02 — review.mode rejects the removed legacy modes", () => {
  // @violation
  // Scenario Outline: Each removed legacy mode is rejected with a typed config error
  //   Then parsing fails with a SovriConfigValidationError
  //   And the error path points at "review.mode"
  it.each(["full", "bugs-only", "strict", "minimal"])(
    "rejects legacy review.mode %j with a SovriConfigValidationError at review.mode",
    (legacy) => {
      let caught: unknown;
      try {
        parseConfigContent(sovriYml(legacy), ".sovri.yml");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(SovriConfigValidationError);
      if (caught instanceof SovriConfigValidationError) {
        const modeIssues = caught.issues.filter((issue) => issue.path.join(".") === "review.mode");
        expect(modeIssues.length).toBeGreaterThanOrEqual(1);
      }
    },
  );

  // @violation
  // Scenario Outline: review.mode is matched case-sensitively against "compliance"
  it.each(["Compliance", "COMPLIANCE", "complianc"])(
    "rejects non-canonical review.mode %j",
    (value) => {
      expect(() => parseConfigContent(sovriYml(value), ".sovri.yml")).toThrow(
        SovriConfigValidationError,
      );
    },
  );
});
