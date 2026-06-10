// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Unit test for the SARIF ingestion conductor: the single composition that turns
// one untrusted SARIF report string into core Findings, applying the bounds
// (R-02), parse (R-01), per-result isolation (R-03), file-escape (R-05),
// kind/suppression drops (R-06), rule resolution + mapping (R-04), CWE
// extraction (R-07), and the per-review cap (R-02). This conductor is the piece
// that was missing between the primitives and the orchestrator.

import { describe, expect, it } from "vitest";

import { collectSarifFindings } from "./ingest.js";
import { SarifParseError } from "./reader.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function reportWith(runs: readonly unknown[]): string {
  return JSON.stringify({ version: "2.1.0", runs });
}

function semgrepRun(results: readonly unknown[], cwe = "CWE-89"): unknown {
  return {
    tool: { driver: { rules: [{ id: "rule-1", properties: { cwe: [cwe] } }] } },
    results,
  };
}

function resultAt(
  uri: string,
  startLine: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ruleId: "rule-1",
    ruleIndex: 0,
    level: "error",
    message: { text: "tainted input reaches a SQL sink" },
    locations: [
      {
        physicalLocation: { artifactLocation: { uri }, region: { startLine, endLine: startLine } },
      },
    ],
    ...overrides,
  };
}

describe("collectSarifFindings — SARIF ingestion conductor", () => {
  it("maps a failing result to a core Finding with source sarif, resolved file, and CWE", () => {
    const raw = reportWith([semgrepRun([resultAt("src/a.ts", 5)])]);

    const { findings, summary } = collectSarifFindings(raw);

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.source).toBe("sarif");
    expect(finding?.file).toBe("src/a.ts");
    expect(finding?.line_start).toBe(5);
    expect(finding?.severity).toBe("major");
    expect(finding?.cwe).toBe("CWE-89");
    expect(finding?.id).toMatch(UUID_V4);
    expect(summary.seen).toBe(1);
    expect(summary.mapped).toBe(1);
  });

  it("drops a result whose kind is not failing (R-06)", () => {
    const raw = reportWith([semgrepRun([resultAt("src/a.ts", 5, { kind: "pass" })])]);

    const { findings, summary } = collectSarifFindings(raw);

    expect(findings).toHaveLength(0);
    expect(summary.skipped).toBe(1);
  });

  it("drops a result with an accepted suppression (R-06)", () => {
    const raw = reportWith([
      semgrepRun([resultAt("src/a.ts", 5, { suppressions: [{ state: "accepted" }] })]),
    ]);

    const { findings } = collectSarifFindings(raw);

    expect(findings).toHaveLength(0);
  });

  it("drops a result whose location escapes the repository (R-05)", () => {
    const raw = reportWith([semgrepRun([resultAt("../../etc/passwd", 1)])]);

    const { findings, summary } = collectSarifFindings(raw);

    expect(findings).toHaveLength(0);
    expect(summary.skipped).toBe(1);
  });

  it("ingests a surviving sibling when one result is off-spec (R-03)", () => {
    const raw = reportWith([
      semgrepRun([resultAt("src/a.ts", 5), { ruleId: "rule-1" /* no physical location */ }]),
    ]);

    const { findings, summary } = collectSarifFindings(raw);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/a.ts");
    expect(summary.seen).toBe(2);
    expect(summary.skipped).toBe(1);
  });

  it("rejects an invalid report whole with a typed SarifParseError (R-01)", () => {
    expect(() => collectSarifFindings(JSON.stringify({ version: "2.0.0", runs: [] }))).toThrow(
      SarifParseError,
    );
    expect(() => collectSarifFindings("not json")).toThrow(SarifParseError);
  });

  it("rejects a report that breaches the nesting-depth bound before parsing (R-02)", () => {
    const tooDeep = "[".repeat(65) + "]".repeat(65);

    expect(() => collectSarifFindings(tooDeep)).toThrow(SarifParseError);
  });
});
