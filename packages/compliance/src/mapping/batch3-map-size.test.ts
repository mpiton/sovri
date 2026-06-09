// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { getCweMap } from "./loader.js";

describe("Batch 3 extends the CWE map total", () => {
  it("exposes exactly 31 entries", () => {
    // batch 1 (14 seed) + batch 2 (12) + batch 3 so far (5) = 31
    expect(getCweMap().size).toBe(31);
  });
});
