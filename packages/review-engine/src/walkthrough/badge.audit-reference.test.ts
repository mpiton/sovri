// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// RED acceptance test for specs/task-117-severity-category-badges/audit-reference.feature
// Rules R-06, R-07. Mirrors the existing convention at inline.ts:91-93 —
//   present  → "\n\n🔍 Audit Reference: <ref>"  (identifier verbatim)
//   absent   → ""

import type { Finding } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { renderAuditReference } from "./badge.js";

describe("renderAuditReference", () => {
  // Scenario: renders the audit-reference line when the finding has one
  it("renders the audit-reference line when the finding has one", () => {
    // Given a finding whose audit_reference is "SOVRI-SE-1A2B-3C4D"
    const finding = { audit_reference: "SOVRI-SE-1A2B-3C4D" };
    // When I call renderAuditReference with that finding
    const out = renderAuditReference(finding);
    // Then it returns exactly "\n\n🔍 Audit Reference: SOVRI-SE-1A2B-3C4D"
    expect(out).toBe("\n\n🔍 Audit Reference: SOVRI-SE-1A2B-3C4D");
    // And the identifier appears verbatim, neither truncated nor reformatted
    expect(out).toContain("SOVRI-SE-1A2B-3C4D");
  });

  // Scenario Outline: the identifier is reproduced unaltered for any valid reference
  it.each(["SOVRI-SE-1A2B-3C4D", "SOVRI-PF-00FF-A1B2", "SOVRI-DO-DEAD-BEEF"])(
    "reproduces %s verbatim",
    (ref) => {
      expect(renderAuditReference({ audit_reference: ref })).toBe(`\n\n🔍 Audit Reference: ${ref}`);
    },
  );

  // Scenario: returns the empty string when the finding has no audit reference
  it("returns the empty string when the finding has no audit reference", () => {
    // Given a finding whose audit_reference is undefined
    const out = renderAuditReference({ audit_reference: undefined });
    // Then it returns exactly "" — no marker, no leading newline
    expect(out).toBe("");
    expect(out).not.toContain("🔍");
    expect(out).not.toContain("\n");
  });

  // Scenario: renderAuditReference reads only audit_reference and is pure
  it("reads only audit_reference and is deterministic", () => {
    const finding: Pick<Finding, "audit_reference"> = { audit_reference: "SOVRI-SE-1A2B-3C4D" };
    expect(renderAuditReference(finding)).toBe(renderAuditReference(finding));
  });
});
