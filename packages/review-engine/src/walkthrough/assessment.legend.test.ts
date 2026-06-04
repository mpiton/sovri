// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as walkthrough from "./index.js";

type RenderAssessmentBlock = (findings: readonly Finding[]) => readonly string[];
type RenderSeverityDistribution = (findings: readonly Finding[]) => readonly string[];

let findingSeq = 0;

function makeFinding(severity: Severity): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `77777777-7777-4777-8777-${hex}`,
    severity,
    category: "bug",
    file: `src/${severity}.ts`,
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    source: "llm",
    confidence: 0.8,
  };
}

function renderAssessmentBlock(): RenderAssessmentBlock {
  const helper = Reflect.get(walkthrough, "renderAssessmentBlock");
  if (!isRenderAssessmentBlock(helper)) {
    throw new TypeError("renderAssessmentBlock export is missing");
  }
  return helper;
}

function renderSeverityDistribution(): RenderSeverityDistribution {
  const helper = Reflect.get(walkthrough, "renderSeverityDistribution");
  if (!isRenderSeverityDistribution(helper)) {
    throw new TypeError("renderSeverityDistribution export is missing");
  }
  return helper;
}

function isRenderAssessmentBlock(value: unknown): value is RenderAssessmentBlock {
  return typeof value === "function";
}

function isRenderSeverityDistribution(value: unknown): value is RenderSeverityDistribution {
  return typeof value === "function";
}

function toText(lines: readonly string[]): string {
  return lines.join("\n");
}

function severityRow(output: string, severity: Severity): string | undefined {
  return output.split("\n").find((line) => line.includes(`${severity}:`));
}

function expectSeverityRow(output: string, severity: Severity, count: number): void {
  expect(severityRow(output, severity)).toContain(
    `${walkthrough.severityBadge(severity)} ${severity}: ${count}`,
  );
}

function expectNoSeverityRow(output: string, severity: Severity): void {
  expect(severityRow(output, severity)).toBeUndefined();
}

describe("assessment severity legend and empty state (R-07)", () => {
  it("lists only severities that occur", () => {
    // Given these findings:
    // | severity |
    // | major    |
    // | minor    |
    // | minor    |
    // | nitpick  |
    const findings = [
      makeFinding("major"),
      makeFinding("minor"),
      makeFinding("minor"),
      makeFinding("nitpick"),
    ];

    // When renderSeverityDistribution is called
    const output = toText(renderSeverityDistribution()(findings));

    // Then only present severities have legend rows with badges and counts
    expectSeverityRow(output, "major", 1);
    expectSeverityRow(output, "minor", 2);
    expectSeverityRow(output, "nitpick", 1);
    expectNoSeverityRow(output, "blocker");
    expectNoSeverityRow(output, "info");
  });

  it("orders legend rows by severity rank", () => {
    // Given findings arrive in nitpick, major, minor order
    const findings = [makeFinding("nitpick"), makeFinding("major"), makeFinding("minor")];

    // When renderSeverityDistribution is called
    const output = toText(renderSeverityDistribution()(findings));

    // Then legend rows appear in severity order
    expect(rowIndex(output, "major")).toBeLessThan(rowIndex(output, "minor"));
    expect(rowIndex(output, "minor")).toBeLessThan(rowIndex(output, "nitpick"));
  });

  it("renders a single explicit empty-state line without distribution markup", () => {
    // Given there are no findings
    const findings: readonly Finding[] = [];

    // When renderAssessmentBlock is called
    const output = toText(renderAssessmentBlock()(findings));

    // Then the output contains a single explicit empty-state line
    expect(output).toBe("No findings — nothing to assess.");
    // And no unicode distribution bar or severity legend rows are rendered
    expect(output).not.toContain("█");
    expect(output).not.toMatch(/(?:blocker|major|minor|info|nitpick): \d/u);
  });
});

function rowIndex(output: string, severity: Severity): number {
  const index = output.split("\n").findIndex((line) => line.includes(`${severity}:`));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}
