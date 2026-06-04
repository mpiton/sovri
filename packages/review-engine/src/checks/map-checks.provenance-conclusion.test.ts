// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { mapChecks, type CheckRunDescriptor, type CheckRunName } from "./index.js";

function descriptorNamed(
  descriptors: readonly CheckRunDescriptor[],
  name: CheckRunName,
): CheckRunDescriptor {
  const descriptor = descriptors.find((candidate) => candidate.name === name);
  if (descriptor === undefined) {
    throw new Error(`${name} descriptor not found`);
  }

  return descriptor;
}

describe("GitHub Checks descriptors - provenance conclusion mapping (R-04)", () => {
  it("maps signed audit evidence to a successful provenance check", () => {
    // Given the review verdict is "approve"
    // And the review has 0 findings
    // And a signed audit entry is available
    const input = {
      verdict: { kind: "approve", label: "Approve" },
      findingCount: 0,
      hasSignedAuditEntry: true,
    };

    // When the Sovri check descriptors are mapped
    const descriptor = descriptorNamed(mapChecks(input), "Sovri / provenance");

    // Then the "Sovri / provenance" descriptor conclusion is "success"
    expect(descriptor.conclusion).toBe("success");

    // And its summary mentions a signed audit entry
    expect(descriptor.summary).toContain("signed audit entry");
  });

  it("keeps missing signed audit evidence neutral by design", () => {
    // Given the review verdict is "approve"
    // And the review has 0 findings
    // And no signed audit entry is available
    const input = {
      verdict: { kind: "approve", label: "Approve" },
      findingCount: 0,
      hasSignedAuditEntry: false,
    };

    // When the Sovri check descriptors are mapped
    const descriptor = descriptorNamed(mapChecks(input), "Sovri / provenance");

    // Then the "Sovri / provenance" descriptor conclusion is "neutral"
    expect(descriptor.conclusion).toBe("neutral");

    // And its summary explains that no signed audit trail is attached
    expect(descriptor.summary).toBe("No signed audit trail is attached.");

    // And its conclusion is not "failure"
    expect(descriptor.conclusion).not.toBe("failure");
  });
});
