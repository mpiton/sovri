// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { type Severity } from "../types/Finding.js";

import { computeSeverityRank } from "./severity.js";

describe("computeSeverityRank", () => {
  const allSeverities = [
    "blocker",
    "major",
    "minor",
    "info",
    "nitpick",
  ] satisfies readonly Severity[];

  const expectedRanks: ReadonlyArray<readonly [Severity, number]> = [
    ["blocker", 5],
    ["major", 4],
    ["minor", 3],
    ["info", 2],
    ["nitpick", 1],
  ];

  it.each(expectedRanks)("maps %s to rank %d", (severity, expected) => {
    expect(computeSeverityRank(severity)).toBe(expected);
  });

  it("returns strictly descending ranks across the severity scale", () => {
    const ranks = allSeverities.map(computeSeverityRank);
    for (let i = 1; i < ranks.length; i += 1) {
      const previous = ranks[i - 1];
      const current = ranks[i];
      if (previous === undefined || current === undefined) {
        throw new Error("severity scale produced undefined rank — test setup is broken");
      }
      expect(previous).toBeGreaterThan(current);
    }
  });

  it("is referentially deterministic (same input ⇒ same output)", () => {
    for (const severity of allSeverities) {
      expect(computeSeverityRank(severity)).toBe(computeSeverityRank(severity));
    }
  });

  it("returns integers within the closed range [1, 5]", () => {
    for (const severity of allSeverities) {
      const rank = computeSeverityRank(severity);
      expect(Number.isInteger(rank)).toBe(true);
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(5);
    }
  });

  it("assigns unique ranks across the severity scale", () => {
    const ranks = new Set(allSeverities.map(computeSeverityRank));
    expect(ranks.size).toBe(allSeverities.length);
  });
});
