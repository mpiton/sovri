// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-03 (corrupt-report vs off-spec-result isolation):
// a corrupt report is skipped whole with a typed SarifParseError; a single
// off-spec result drops alone with a counted reason while siblings ingest; each
// report emits an ingestion summary of results seen, mapped, and skipped.

import { describe, expect, it } from "vitest";

import { ingestReport, mapSarifResult } from "./mapper.js";
import { SarifParseError } from "./reader.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AUDIT_REF = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/u;

function resultAt(
  uri: string,
  startLine: number,
  endLine: number,
  message: string,
  level = "error",
): Record<string, unknown> {
  return {
    ruleId: "rule-1",
    level,
    message: { text: message },
    locations: [
      { physicalLocation: { artifactLocation: { uri }, region: { startLine, endLine } } },
    ],
  };
}

function resultWithLocation(uri: string): Record<string, unknown> {
  return {
    ruleId: "rule-1",
    message: { text: "finding" },
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
  };
}

function resultWithoutLocation(): Record<string, unknown> {
  return { ruleId: "rule-1", message: { text: "finding" } };
}

function reportWith(results: readonly unknown[]): string {
  return JSON.stringify({ version: "2.1.0", runs: [{ results }] });
}

describe("ingestReport — R-03 corrupt-report vs off-spec-result isolation", () => {
  it("skips a report with an invalid top-level shape whole", () => {
    // Given a SARIF string that is valid JSON, version "2.1.0", but "runs" is the string "oops"
    const raw = JSON.stringify({ version: "2.1.0", runs: "oops" });

    // When the report is ingested
    // Then a typed SarifParseError is raised (no results from that report are mapped)
    expect(() => ingestReport(raw)).toThrow(SarifParseError);
  });

  it("drops one off-spec result while its siblings ingest", () => {
    // Given a valid 2.1.0 report whose single run has 3 results, the 2nd with no physical location
    const raw = reportWith([
      resultWithLocation("src/a.ts"),
      resultWithoutLocation(),
      resultWithLocation("src/b.ts"),
    ]);

    // When the report is ingested
    const ingestion = ingestReport(raw);

    // Then the 1st and 3rd results survive and the 2nd is dropped with the reason "no-physical-location"
    expect(ingestion.results).toHaveLength(2);
    expect(ingestion.summary.mapped).toBe(2);
    expect(ingestion.summary.skippedReasons["no-physical-location"]).toBe(1);
  });

  it("emits a summary of results seen, mapped, and skipped with reason counts", () => {
    // Given a valid 2.1.0 report whose single run has 5 results, 2 of them off-spec
    const raw = reportWith([
      resultWithLocation("src/a.ts"),
      resultWithoutLocation(),
      resultWithLocation("src/b.ts"),
      resultWithoutLocation(),
      resultWithLocation("src/c.ts"),
    ]);

    // When the report is ingested
    const { summary } = ingestReport(raw);

    // Then the summary reports 5 seen, 3 mapped, and 2 skipped, each reason with its count
    expect(summary.seen).toBe(5);
    expect(summary.mapped).toBe(3);
    expect(summary.skipped).toBe(2);
    expect(summary.skippedReasons).toEqual({ "no-physical-location": 2 });
  });
});

describe("mapSarifResult — R-04 result to core Finding", () => {
  it("maps a result to a Finding with source sarif and all required fields populated", () => {
    // Given a SARIF result on "src/api/users.ts" lines 40 to 44 with level "error"
    // And the result message text is "SQL string built from user input"
    const result = resultAt("src/api/users.ts", 40, 44, "SQL string built from user input");

    // When the result is mapped
    const finding = mapSarifResult(result, { id: "rule-1" });

    // Then a Finding is produced with source "sarif" and every required field populated
    expect(finding.source).toBe("sarif");
    expect(finding.file).toBe("src/api/users.ts");
    expect(finding.line_start).toBe(40);
    expect(finding.line_end).toBe(44);
    expect(finding.severity).toBe("major");
    expect(finding.category.length).toBeGreaterThan(0);
    expect(finding.title.length).toBeGreaterThan(0);
    expect(finding.body).toContain("SQL string built from user input");
    expect(finding.recommendation.length).toBeGreaterThan(0);
    expect(finding.confidence).toBeGreaterThan(0);
    // And the Finding has a generated id and audit_reference
    expect(finding.id).toMatch(UUID_V4);
    expect(finding.audit_reference).toMatch(AUDIT_REF);
  });

  it("truncates an over-long title to 200 rather than dropping the result", () => {
    // Given a SARIF result whose title source text is 250 characters long
    const result = resultAt("src/a.ts", 1, 1, "m");
    const rule = { id: "rule-1", shortDescription: { text: "T".repeat(250) } };

    // When the result is mapped
    const finding = mapSarifResult(result, rule);

    // Then the Finding title is exactly 200 characters long
    expect(finding.title).toHaveLength(200);
  });

  it("truncates an over-long body to 2000 rather than dropping the result", () => {
    // Given a SARIF result whose body source text is 2500 characters long
    const result = resultAt("src/a.ts", 1, 1, "B".repeat(2500));

    // When the result is mapped
    const finding = mapSarifResult(result, { id: "rule-1" });

    // Then the Finding body is exactly 2000 characters long
    expect(finding.body).toHaveLength(2000);
  });

  it("truncates an over-long recommendation to 1000 rather than dropping the result", () => {
    // Given a SARIF result whose recommendation source text is 1200 characters long
    const result = resultAt("src/a.ts", 1, 1, "m");
    const rule = { id: "rule-1", help: { text: "R".repeat(1200) } };

    // When the result is mapped
    const finding = mapSarifResult(result, rule);

    // Then the Finding recommendation is exactly 1000 characters long
    expect(finding.recommendation).toHaveLength(1000);
  });

  it("resolves the human message from result.message.text first", () => {
    // Given a SARIF result whose message.text is "Hardcoded credential detected"
    const result = resultAt("src/a.ts", 5, 5, "Hardcoded credential detected");

    // When the result is mapped
    const finding = mapSarifResult(result, { id: "rule-1" });

    // Then the Finding body is derived from "Hardcoded credential detected"
    expect(finding.body).toContain("Hardcoded credential detected");
  });

  it("falls back to the rule messageString with argument substitution", () => {
    // Given a SARIF result with no message.text and message.id "default"
    // And the rule defines messageStrings.default.text "Tainted data reaches {0} via {1}"
    // And the result message arguments are ["exec", "req.body"]
    const result = {
      ruleId: "rule-1",
      level: "error",
      message: { id: "default", arguments: ["exec", "req.body"] },
      locations: [
        { physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 5 } } },
      ],
    };
    const rule = {
      id: "rule-1",
      messageStrings: { default: { text: "Tainted data reaches {0} via {1}" } },
    };

    // When the result is mapped
    const finding = mapSarifResult(result, rule);

    // Then the Finding body contains "Tainted data reaches exec via req.body"
    expect(finding.body).toContain("Tainted data reaches exec via req.body");
  });

  it("falls back to a deterministic placeholder when no message is resolvable", () => {
    // Given a SARIF result with no message.text and no resolvable rule messageString
    const result = {
      ruleId: "no-msg-rule",
      level: "error",
      locations: [
        { physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 5 } } },
      ],
    };

    // When the result is mapped
    // Then the Finding body is a deterministic fallback referencing the rule id
    const firstBody = mapSarifResult(result, { id: "no-msg-rule" }).body;
    expect(firstBody).toContain("no-msg-rule");
    // And mapping the same result again produces the identical body
    expect(mapSarifResult(result, { id: "no-msg-rule" }).body).toBe(firstBody);
  });
});
