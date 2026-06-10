// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-02 (SARIF input bounds enforced before parsing):
// raw byte cap per report (10 MiB inclusive), JSON nesting-depth bound (64
// inclusive, guards a JSON.parse stack overflow), and a per-review findings cap
// (1000) with deterministic overflow drop. Bounds are checked before any work.

import { describe, expect, it } from "vitest";

import { capFindings, checkReportBounds } from "./caps.js";

const TEN_MIB = 10_485_760;

// A raw string of an exact UTF-8 byte length, using ASCII so 1 char == 1 byte.
function rawOfBytes(bytes: number): string {
  return "a".repeat(bytes);
}

// A JSON-array string nested to an exact bracket depth (depth N == N opening
// brackets). Byte length stays tiny, isolating the depth bound from the byte cap.
function rawOfDepth(depth: number): string {
  return "[".repeat(depth) + "]".repeat(depth);
}

describe("checkReportBounds — R-02 byte and nesting bounds", () => {
  it("accepts a report under every bound", () => {
    // Given a SARIF report of 1048576 bytes with nesting depth 8
    const raw = rawOfDepth(8) + rawOfBytes(1_048_576);

    // When the report is checked
    // Then no bound is violated
    expect(checkReportBounds(raw)).toBeNull();
  });

  it("accepts a report exactly at the 10 MiB byte cap (inclusive)", () => {
    // Given a SARIF report whose raw size is exactly 10485760 bytes
    const raw = rawOfBytes(TEN_MIB);

    // When the report is checked
    // Then the report is not rejected for size
    expect(checkReportBounds(raw)).toBeNull();
  });

  it("skips a report one byte above the 10 MiB cap with the observed byte count", () => {
    // Given a SARIF report whose raw size is 10485761 bytes
    const raw = rawOfBytes(TEN_MIB + 1);

    // When the report is checked
    // Then the whole report is skipped before parsing
    const violation = checkReportBounds(raw);
    // And a "report-too-large" event carries the observed byte count
    expect(violation).toEqual({
      reason: "report-too-large",
      observed: TEN_MIB + 1,
      limit: TEN_MIB,
    });
  });

  it("skips a report exceeding the nesting-depth bound", () => {
    // Given a SARIF report whose JSON nesting depth is 65
    const raw = rawOfDepth(65);

    // When the report is checked
    // Then the whole report is skipped with a "nesting-too-deep" event
    const violation = checkReportBounds(raw);
    expect(violation).toEqual({ reason: "nesting-too-deep", observed: 65, limit: 64 });
  });

  it("accepts a report at exactly the nesting-depth bound (inclusive)", () => {
    // Given a SARIF report whose JSON nesting depth is 64
    const raw = rawOfDepth(64);

    // When the report is checked
    // Then the report is not rejected for nesting depth
    expect(checkReportBounds(raw)).toBeNull();
  });
});

describe("capFindings — R-02 per-review findings cap", () => {
  it("keeps the first 1000 findings and drops the deterministic overflow", () => {
    // Given valid reports yielding 1001 mappable SARIF results in a fixed order
    const items = Array.from({ length: 1001 }, (_, index) => `finding-${index}`);

    // When the results are capped for one review
    const first = capFindings(items);
    const second = capFindings(items);

    // Then exactly the first 1000 results in that order are kept
    expect(first.kept).toHaveLength(1000);
    expect(first.kept[0]).toBe("finding-0");
    expect(first.kept[999]).toBe("finding-999");
    // And the 1001st result is dropped
    expect(first.dropped).toBe(1);
    expect(first.kept).not.toContain("finding-1000");
    // And the dropped result is always the same one across repeated runs
    expect(second.kept).toEqual(first.kept);
  });

  it("keeps every finding when under the cap", () => {
    // Given a report yielding 12 mappable SARIF results
    const items = Array.from({ length: 12 }, (_, index) => `finding-${index}`);

    // When the results are capped
    const result = capFindings(items);

    // Then all 12 results are kept and none are dropped
    expect(result.kept).toHaveLength(12);
    expect(result.dropped).toBe(0);
  });
});
