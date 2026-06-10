// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-03 (corrupt-report vs off-spec-result isolation):
// a corrupt report is skipped whole with a typed SarifParseError; a single
// off-spec result drops alone with a counted reason while siblings ingest; each
// report emits an ingestion summary of results seen, mapped, and skipped.

import { describe, expect, it } from "vitest";

import { ingestReport } from "./mapper.js";
import { SarifParseError } from "./reader.js";

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
