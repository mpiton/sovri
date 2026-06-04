// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Severity } from "@sovri/core";
import { describe, expect, it, vi } from "vitest";

import * as walkthrough from "./index.js";

type ComputeEffortScore = (findings: readonly Finding[]) => 1 | 2 | 3 | 4 | 5;

let findingSeq = 0;

function makeFinding(severity: Severity, confidence: number, file = "src/review.ts"): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `44444444-4444-4444-8444-${hex}`,
    severity,
    category: "bug",
    file,
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    source: "llm",
    confidence,
  };
}

function computeEffortScore(): ComputeEffortScore {
  const helper = Reflect.get(walkthrough, "computeEffortScore");
  if (!isComputeEffortScore(helper)) {
    throw new TypeError("computeEffortScore export is missing");
  }
  return helper;
}

function isComputeEffortScore(value: unknown): value is ComputeEffortScore {
  return typeof value === "function";
}

describe("assessment effort score purity and range (R-01)", () => {
  it("returns the same score for the same findings on repeated calls", () => {
    // Given these findings:
    // | severity | file     | confidence |
    // | major    | src/a.ts | 0.80       |
    // | minor    | src/b.ts | 0.75       |
    const findings = [
      makeFinding("major", 0.8, "src/a.ts"),
      makeFinding("minor", 0.75, "src/b.ts"),
    ];

    // When computeEffortScore is called twice with the same findings
    const score = computeEffortScore();
    const first = score(findings);
    const second = score(findings);

    // Then both calls return exactly 4
    expect(first).toBe(4);
    expect(second).toBe(4);
    // And the two return values are byte-identical
    expect(first).toBe(second);
  });

  it("does not depend on external runtime changes", () => {
    // Given these findings:
    // | severity | file     | confidence |
    // | minor    | src/a.ts | 0.70       |
    // | info     | src/b.ts | 0.70       |
    const findings = [makeFinding("minor", 0.7, "src/a.ts"), makeFinding("info", 0.7, "src/b.ts")];

    // And the process clock, environment, and random source are changed between calls
    const score = computeEffortScore();
    const beforeExternalChanges = score(findings);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_780_000_000_000);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const previousEnv = process.env.SOVRI_TEST_EFFORT_SCORE;
    process.env.SOVRI_TEST_EFFORT_SCORE = "5";

    // When computeEffortScore is called before and after those external changes
    try {
      const afterExternalChanges = score(findings);

      // Then both calls return exactly 3
      expect(beforeExternalChanges).toBe(3);
      expect(afterExternalChanges).toBe(3);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.SOVRI_TEST_EFFORT_SCORE;
      } else {
        process.env.SOVRI_TEST_EFFORT_SCORE = previousEnv;
      }
      now.mockRestore();
      random.mockRestore();
    }
  });

  it.each([
    ["no findings", []],
    ["one nitpick finding", [makeFinding("nitpick", 0.7)]],
    ["one info finding", [makeFinding("info", 0.7)]],
    ["one minor finding", [makeFinding("minor", 0.7)]],
    ["one major finding", [makeFinding("major", 0.7)]],
    ["one blocker finding", [makeFinding("blocker", 0.7)]],
    [
      "ten mixed findings",
      [
        makeFinding("major", 0.9),
        makeFinding("minor", 0.8),
        makeFinding("minor", 0.8),
        makeFinding("info", 0.8),
        makeFinding("info", 0.8),
        makeFinding("info", 0.8),
        makeFinding("nitpick", 0.8),
        makeFinding("nitpick", 0.8),
        makeFinding("nitpick", 0.8),
        makeFinding("nitpick", 0.8),
      ],
    ],
  ] satisfies ReadonlyArray<readonly [string, readonly Finding[]]>)(
    "returns an integer in the closed interval 1 to 5 for %s",
    (_caseName, findings) => {
      // Given a findings list named "<case>"
      // When computeEffortScore is called
      const result = computeEffortScore()(findings);

      // Then the score is an integer
      expect(Number.isInteger(result)).toBe(true);
      // And the score is greater than or equal to 1
      expect(result).toBeGreaterThanOrEqual(1);
      // And the score is less than or equal to 5
      expect(result).toBeLessThanOrEqual(5);
    },
  );
});
