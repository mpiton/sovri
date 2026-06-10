// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-07 (CWE extraction and canonicalization across tool
// shapes): Semgrep rule.properties.cwe, CodeQL zero-padded tags, and taxa /
// rule.relationships resolved against run.taxonomies, canonicalized to
// ^CWE-\d+$. CWE is optional; multiple ids keep the first in document order.

import { describe, expect, it } from "vitest";

import { extractCwe } from "./cwe.js";

const EMPTY_RESULT: Record<string, unknown> = { ruleId: "rule-1" };

describe("extractCwe — R-07 CWE extraction and canonicalization", () => {
  it("extracts a canonical CWE id from a Semgrep cwe property array", () => {
    // Given rule.properties.cwe is ["CWE-89: SQL Injection"]
    const rule = { id: "rule-1", properties: { cwe: ["CWE-89: SQL Injection"] } };

    // When the CWE is extracted / Then it is "CWE-89"
    expect(extractCwe(EMPTY_RESULT, rule)).toBe("CWE-89");
  });

  it("strips a zero-padded CodeQL cwe tag to canonical form", () => {
    // Given rule.properties.tags includes "external/cwe/cwe-079"
    const rule = { id: "rule-1", properties: { tags: ["security", "external/cwe/cwe-079"] } };

    // When the CWE is extracted / Then it is "CWE-79"
    expect(extractCwe(EMPTY_RESULT, rule)).toBe("CWE-79");
  });

  it("resolves a taxa reference against the run CWE taxonomy", () => {
    // Given a run taxonomy named "CWE" with a taxon "22" at index 0
    const run = { taxonomies: [{ name: "CWE", taxa: [{ id: "22" }] }] };
    // And a result whose taxa references that taxonomy index 0
    const result = { ruleId: "rule-1", taxa: [{ toolComponentIndex: 0, index: 0 }] };

    // When the CWE is extracted / Then it is "CWE-22"
    expect(extractCwe(result, { id: "rule-1" }, run)).toBe("CWE-22");
  });

  it("resolves a rule.relationships reference against the run CWE taxonomy", () => {
    // Given a run taxonomy named "CWE" with a taxon "352" at index 0
    const run = { taxonomies: [{ name: "CWE", taxa: [{ id: "352" }] }] };
    // And a rule whose relationship targets that taxonomy index 0
    const rule = {
      id: "rule-1",
      relationships: [{ target: { index: 0, toolComponent: { index: 0 } } }],
    };

    // When the CWE is extracted / Then it is "CWE-352"
    expect(extractCwe(EMPTY_RESULT, rule, run)).toBe("CWE-352");
  });

  it("returns undefined when the result carries no CWE", () => {
    // Given a Gitleaks result with no cwe property, tag, or taxa
    const rule = { id: "rule-1", properties: { tags: ["secret"] } };

    // When the CWE is extracted / Then it is undefined
    expect(extractCwe(EMPTY_RESULT, rule)).toBeUndefined();
  });

  it("keeps the first CWE in document order when several are present", () => {
    // Given rule.properties.cwe is ["CWE-89", "CWE-564"]
    const rule = { id: "rule-1", properties: { cwe: ["CWE-89", "CWE-564"] } };

    // When the CWE is extracted / Then it is "CWE-89"
    expect(extractCwe(EMPTY_RESULT, rule)).toBe("CWE-89");
  });

  it("ignores a malformed token and keeps the first valid CWE", () => {
    // Given rule.properties.cwe is ["not-a-cwe", "CWE-787"]
    const rule = { id: "rule-1", properties: { cwe: ["not-a-cwe", "CWE-787"] } };

    // When the CWE is extracted / Then it is "CWE-787"
    expect(extractCwe(EMPTY_RESULT, rule)).toBe("CWE-787");
  });
});
