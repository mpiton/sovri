// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-01 (SARIF report acceptance at the boundary):
// a SARIF report is accepted only if it is valid JSON and version === "2.1.0"
// (exact). $schema is optional and ignored; runs[] may be empty; run.results is
// optional. The reader validates untrusted external input at the boundary.

import { describe, expect, it } from "vitest";

import { parseSarifReport, SarifParseError, type SarifLog } from "./reader.js";

function countResults(log: SarifLog): number {
  return log.runs.flatMap((run) => run.results ?? []).length;
}

function resultOn(uri: string): Record<string, unknown> {
  return {
    ruleId: "rule-1",
    message: { text: "finding" },
    locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }],
  };
}

describe("parseSarifReport — R-01 acceptance at the boundary", () => {
  it("accepts a valid 2.1.0 report with a $schema field and one result", () => {
    // Given a SARIF string with "version" equal to "2.1.0" and a "$schema" field
    // And the report has one run with one result on "src/auth.ts"
    const raw = JSON.stringify({
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [{ results: [resultOn("src/auth.ts")] }],
    });

    // When the reader validates the report
    // Then the report is accepted
    expect(() => parseSarifReport(raw)).not.toThrow();
    // And one SARIF result is available for mapping
    expect(countResults(parseSarifReport(raw))).toBe(1);
  });

  it("accepts a 2.1.0 report with no $schema field", () => {
    // Given a SARIF string with "version" equal to "2.1.0" and no "$schema" field
    // And the report has one run with one result on "src/db.ts"
    const raw = JSON.stringify({
      version: "2.1.0",
      runs: [{ results: [resultOn("src/db.ts")] }],
    });

    // When the reader validates the report
    // Then the report is accepted
    expect(() => parseSarifReport(raw)).not.toThrow();
    // And one SARIF result is available for mapping
    expect(countResults(parseSarifReport(raw))).toBe(1);
  });

  it("accepts a report with an empty runs array and yields no findings", () => {
    // Given a SARIF string with "version" equal to "2.1.0" and "runs" equal to []
    const raw = JSON.stringify({ version: "2.1.0", runs: [] });

    // When the reader validates the report
    // Then the report is accepted
    const log = parseSarifReport(raw);
    // And no SARIF results are available for mapping
    expect(countResults(log)).toBe(0);
  });

  it("accepts a run that carries notifications but no results", () => {
    // Given a SARIF string with "version" equal to "2.1.0"
    // And the single run has no "results" field but one toolExecutionNotification
    const raw = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          invocations: [
            { toolExecutionNotifications: [{ level: "note", message: { text: "scan ran" } }] },
          ],
        },
      ],
    });

    // When the reader validates the report
    // Then the report is accepted
    const log = parseSarifReport(raw);
    // And no SARIF results are available for mapping
    expect(countResults(log)).toBe(0);
  });

  it("rejects a report with a non-2.1.0 version whole", () => {
    // Given a SARIF string with "version" equal to "2.0.0"
    const raw = JSON.stringify({ version: "2.0.0", runs: [] });

    // When the reader validates the report
    // Then the report is rejected with a typed SarifParseError
    expect(() => parseSarifReport(raw)).toThrow(SarifParseError);
  });

  it("rejects a report whose version field is absent whole", () => {
    // Given a SARIF string that is valid JSON with no "version" field
    const raw = JSON.stringify({ runs: [] });

    // When the reader validates the report
    // Then the report is rejected with a typed SarifParseError
    expect(() => parseSarifReport(raw)).toThrow(SarifParseError);
  });

  it("rejects a non-JSON string whole", () => {
    // Given a SARIF string equal to "{ not valid json"
    const raw = "{ not valid json";

    // When the reader validates the report
    // Then the report is rejected with a typed SarifParseError
    expect(() => parseSarifReport(raw)).toThrow(SarifParseError);
  });
});
