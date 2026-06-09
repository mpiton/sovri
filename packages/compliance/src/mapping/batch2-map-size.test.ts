// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { getCweMap } from "./loader.js";

const batchTwoNewCweIds = [
  "CWE-20",
  "CWE-77",
  "CWE-121",
  "CWE-122",
  "CWE-200",
  "CWE-284",
  "CWE-306",
  "CWE-502",
  "CWE-639",
  "CWE-770",
  "CWE-863",
  "CWE-918",
];

describe("The static CWE map reaches the full Top 25 2025 plus CWE-798", () => {
  it("exposes at least the twenty-six batch 2 entries", () => {
    expect(getCweMap().size).toBeGreaterThanOrEqual(26);
  });

  it.each(batchTwoNewCweIds)("contains the new batch 2 entry %s", (cweId) => {
    expect(getCweMap().has(cweId)).toBe(true);
  });

  it("enriches CWE-798 without creating a duplicate entry", () => {
    // Given CWE-798 already existed as a seed before batch 2
    const map = getCweMap();

    // When getCweMap is read after batch 2
    const cwe798Keys = [...map.keys()].filter((key) => key === "CWE-798");

    // Then exactly one entry has cwe_id CWE-798 and the map has at least 26 entries
    expect(cwe798Keys).toHaveLength(1);
    expect(map.size).toBeGreaterThanOrEqual(26);
  });
});
