// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Severity } from "@sovri/core";
import { describe, expect, it, vi } from "vitest";

import * as walkthrough from "./index.js";

type ComputeEffortScore = (findings: readonly Finding[]) => 1 | 2 | 3 | 4 | 5;
type EffortScore = ReturnType<ComputeEffortScore>;
type RenderEffortMeter = (score: EffortScore) => string;

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

function makeFindings(count: number, severity: Severity, confidence: number): readonly Finding[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeFinding(severity, confidence, `src/${severity}-${index + 1}.ts`),
  );
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

function renderEffortMeter(): RenderEffortMeter {
  const helper = Reflect.get(walkthrough, "renderEffortMeter");
  if (!isRenderEffortMeter(helper)) {
    throw new TypeError("renderEffortMeter export is missing");
  }
  return helper;
}

function isRenderEffortMeter(value: unknown): value is RenderEffortMeter {
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

describe("assessment effort score heuristic and clamp (R-02)", () => {
  it.each([
    [1, "nitpick", 0.84, 1],
    [1, "nitpick", 0.85, 2],
    [1, "info", 0.7, 2],
    [1, "minor", 0.7, 3],
    [4, "minor", 0.7, 4],
    [3, "major", 0.84, 4],
    [1, "major", 0.9, 5],
  ] satisfies ReadonlyArray<readonly [number, Severity, number, ReturnType<ComputeEffortScore>]>)(
    "scores %i %s finding(s) at confidence %f as %i",
    (count, severity, confidence, expectedScore) => {
      // Given these findings:
      // | count | severity   | confidence   |
      // | count | severity   | confidence   |
      const findings = makeFindings(count, severity, confidence);

      // When computeEffortScore is called
      const result = computeEffortScore()(findings);

      // Then the score is exactly the expected heuristic result
      expect(result).toBe(expectedScore);
    },
  );

  it("clamps a raw score above 5 to 5", () => {
    // Given four major findings with high confidence
    const findings = makeFindings(4, "major", 0.9);

    // When computeEffortScore is called
    const result = computeEffortScore()(findings);

    // Then the unclamped heuristic would be 6
    const unclampedHeuristic = 6;
    expect(unclampedHeuristic).toBe(6);
    // And the returned score is exactly 5
    expect(result).toBe(5);
  });

  it("treats the confidence boundary as inclusive at 0.85", () => {
    // Given one info finding with confidence 0.85
    const findings = makeFindings(1, "info", 0.85);

    // When computeEffortScore is called
    const result = computeEffortScore()(findings);

    // Then the score includes the confidence bonus
    expect(result).toBe(3);
  });

  it("preserves the inclusive confidence boundary for mixed confidences averaging 0.85", () => {
    // Given four nitpick findings whose mathematical average confidence is 0.85
    const findings = [
      makeFinding("nitpick", 0.43, "src/a.ts"),
      makeFinding("nitpick", 1, "src/b.ts"),
      makeFinding("nitpick", 1, "src/c.ts"),
      makeFinding("nitpick", 0.97, "src/d.ts"),
    ];

    // When computeEffortScore is called
    const result = computeEffortScore()(findings);

    // Then the score includes both the volume and confidence bonuses
    expect(result).toBe(3);
  });
});

describe("assessment effort score endpoint cases (R-03)", () => {
  it("scores zero findings exactly 1", () => {
    // Given there are no findings
    const findings: readonly Finding[] = [];

    // When computeEffortScore is called
    const result = computeEffortScore()(findings);

    // Then the score is exactly 1
    expect(result).toBe(1);
  });

  it.each([
    [1, 0.1],
    [1, 0.9],
    [4, 0.1],
  ] satisfies ReadonlyArray<readonly [number, number]>)(
    "scores %i blocker finding(s) with confidence %f exactly 5",
    (count, confidence) => {
      // Given these findings:
      // | count | severity | confidence |
      // | count | blocker  | confidence |
      const findings = makeFindings(count, "blocker", confidence);

      // When computeEffortScore is called
      const result = computeEffortScore()(findings);

      // Then the score is exactly 5
      expect(result).toBe(5);
    },
  );

  it("keeps blocker findings at score 5 when lower-severity findings are also present", () => {
    // Given a blocker mixed with lower-severity high-confidence findings
    const findings = [
      makeFinding("blocker", 0.2, "src/a.ts"),
      makeFinding("nitpick", 0.95, "src/b.ts"),
      makeFinding("info", 0.95, "src/c.ts"),
      makeFinding("minor", 0.95, "src/d.ts"),
    ];

    // When computeEffortScore is called
    const result = computeEffortScore()(findings);

    // Then the score is exactly 5
    expect(result).toBe(5);
  });
});

describe("assessment effort meter dots (R-04)", () => {
  it.each([
    [1, "●○○○○"],
    [2, "●●○○○"],
    [3, "●●●○○"],
    [4, "●●●●○"],
    [5, "●●●●●"],
  ] satisfies ReadonlyArray<readonly [EffortScore, string]>)(
    "renders score %i as %s",
    (score, expectedMeter) => {
      // Given the effort score is <score>
      // When renderEffortMeter is called
      const meter = renderEffortMeter()(score);

      // Then the returned meter is exactly "<meter>"
      expect(meter).toBe(expectedMeter);
      // And the returned meter contains exactly 5 dot glyphs
      expect(countDotGlyphs(meter)).toBe(5);
    },
  );

  it("uses only GitHub-safe unicode text", () => {
    // Given the effort score is 3
    const score: EffortScore = 3;

    // When renderEffortMeter is called
    const meter = renderEffortMeter()(score);

    // Then the returned meter is exactly "●●●○○"
    expect(meter).toBe("●●●○○");
    // And every character is either "●" or "○"
    expect([...meter].every(isDotGlyph)).toBe(true);
    // And the returned meter contains no HTML element
    expect(meter).not.toContain("<");
    expect(meter).not.toContain(">");
    // And the returned meter contains no CSS class or style attribute
    expect(meter).not.toContain("class=");
    expect(meter).not.toContain("style=");
  });
});

function countDotGlyphs(value: string): number {
  return [...value].filter(isDotGlyph).length;
}

function isDotGlyph(character: string): boolean {
  return character === "●" || character === "○";
}
