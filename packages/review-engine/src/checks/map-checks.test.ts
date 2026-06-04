// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { mapChecks } from "./index.js";

describe("GitHub Checks descriptors — stable rows (R-01)", () => {
  it("returns exactly the three stable Sovri check descriptors in order", () => {
    // Given the review verdict is "approve"
    // And the review has 0 findings
    // And no signed audit entry is available
    const input = {
      verdict: { kind: "approve", label: "Approve" },
      findingCount: 0,
      hasSignedAuditEntry: false,
    } as const;

    // When the Sovri check descriptors are mapped
    const descriptors = mapChecks(input);

    // Then exactly 3 descriptors are returned
    expect(descriptors).toHaveLength(3);

    // And descriptor 1 is named "Sovri / review"
    // And descriptor 2 is named "Sovri / provenance"
    // And descriptor 3 is named "Sovri / license-scan"
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual([
      "Sovri / review",
      "Sovri / provenance",
      "Sovri / license-scan",
    ]);

    // And every descriptor status is "completed"
    expect(descriptors.every((descriptor) => descriptor.status === "completed")).toBe(true);
  });

  it("does not create extra check descriptors when findings are present", () => {
    // Given the review verdict is "request-changes"
    // And the review has 4 findings
    // And a signed audit entry is available
    const input = {
      verdict: { kind: "request-changes", label: "Request changes" },
      findingCount: 4,
      hasSignedAuditEntry: true,
    } as const;

    // When the Sovri check descriptors are mapped
    const descriptors = mapChecks(input);

    // Then exactly 3 descriptors are returned
    expect(descriptors).toHaveLength(3);

    // And the descriptor names stay "Sovri / review", "Sovri / provenance", and
    // "Sovri / license-scan" in that order
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual([
      "Sovri / review",
      "Sovri / provenance",
      "Sovri / license-scan",
    ]);
  });
});
