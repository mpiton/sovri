// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as walkthrough from "./index.js";

type RenderSeverityDistribution = (findings: readonly Finding[]) => readonly string[];

let findingSeq = 0;

function makeFinding(severity: Severity): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `66666666-6666-4666-8666-${hex}`,
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

function renderSeverityDistribution(): RenderSeverityDistribution {
  const helper = Reflect.get(walkthrough, "renderSeverityDistribution");
  if (!isRenderSeverityDistribution(helper)) {
    throw new TypeError("renderSeverityDistribution export is missing");
  }
  return helper;
}

function isRenderSeverityDistribution(value: unknown): value is RenderSeverityDistribution {
  return typeof value === "function";
}

function toText(lines: readonly string[]): string {
  return lines.join("\n");
}

function expectCount(output: string, severity: Severity, count: number): void {
  expect(output).toContain(`${severity}: ${count}`);
}

describe("assessment severity distribution counts (R-06)", () => {
  it("counts each finding exactly once and exposes the total", () => {
    // Given these findings:
    // | severity |
    // | blocker  |
    // | major    |
    // | minor    |
    // | minor    |
    // | info     |
    // | nitpick  |
    const findings = [
      makeFinding("blocker"),
      makeFinding("major"),
      makeFinding("minor"),
      makeFinding("minor"),
      makeFinding("info"),
      makeFinding("nitpick"),
    ];

    // When renderSeverityDistribution is called
    const output = toText(renderSeverityDistribution()(findings));

    // Then the distribution reports 6 total findings
    expect(output).toContain("Total: 6 findings");
    // And the per-severity counts are visible
    expectCount(output, "blocker", 1);
    expectCount(output, "major", 1);
    expectCount(output, "minor", 2);
    expectCount(output, "info", 1);
    expectCount(output, "nitpick", 1);
    // And the per-severity counts add up to 6
    expect(sumVisibleCounts(output)).toBe(6);
  });

  it("reports one finding for each core severity", () => {
    // Given every core severity appears exactly once
    const findings = [
      makeFinding("blocker"),
      makeFinding("major"),
      makeFinding("minor"),
      makeFinding("info"),
      makeFinding("nitpick"),
    ];

    // When renderSeverityDistribution is called
    const output = toText(renderSeverityDistribution()(findings));

    // Then the distribution reports one finding for each core severity
    expectCount(output, "blocker", 1);
    expectCount(output, "major", 1);
    expectCount(output, "minor", 1);
    expectCount(output, "info", 1);
    expectCount(output, "nitpick", 1);
    // And the per-severity counts add up to 5
    expect(sumVisibleCounts(output)).toBe(5);
  });

  it("renders a textual bar while keeping raw integer counts visible", () => {
    // Given three findings whose bar may need rounding in future renderers
    const findings = [makeFinding("major"), makeFinding("minor"), makeFinding("minor")];

    // When renderSeverityDistribution is called
    const output = toText(renderSeverityDistribution()(findings));

    // Then the output contains a unicode block bar
    expect(output).toContain("█");
    // And the raw integer counts remain visible in the legend
    expectCount(output, "major", 1);
    expectCount(output, "minor", 2);
    // And the raw integer counts add up to 3 regardless of bar rounding
    expect(sumVisibleCounts(output)).toBe(3);
  });
});

function sumVisibleCounts(output: string): number {
  return [...output.matchAll(/(?:blocker|major|minor|info|nitpick): (\d+)/gu)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
}
