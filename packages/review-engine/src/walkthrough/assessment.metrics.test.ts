// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import * as walkthrough from "./index.js";

type RenderMetricChips = (findings: readonly Finding[]) => string;

let findingSeq = 0;

function makeFinding(severity: Severity, file: string): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `55555555-5555-4555-8555-${hex}`,
    severity,
    category: "bug",
    file,
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    source: "llm",
    confidence: 0.8,
  };
}

function renderMetricChips(): RenderMetricChips {
  const helper = Reflect.get(walkthrough, "renderMetricChips");
  if (!isRenderMetricChips(helper)) {
    throw new TypeError("renderMetricChips export is missing");
  }
  return helper;
}

function isRenderMetricChips(value: unknown): value is RenderMetricChips {
  return typeof value === "function";
}

describe("assessment metric chips (R-05)", () => {
  it("counts findings, distinct files, and blocker plus major findings", () => {
    // Given these findings:
    // | severity | file     |
    // | blocker  | src/a.ts |
    // | major    | src/a.ts |
    // | minor    | src/b.ts |
    // | info     | src/c.ts |
    // | nitpick  | src/c.ts |
    const findings = [
      makeFinding("blocker", "src/a.ts"),
      makeFinding("major", "src/a.ts"),
      makeFinding("minor", "src/b.ts"),
      makeFinding("info", "src/c.ts"),
      makeFinding("nitpick", "src/c.ts"),
    ];

    // When renderMetricChips is called
    const output = renderMetricChips()(findings);

    // Then the output reports 5 findings
    expect(output).toContain("5 findings");
    // And the output reports 3 files touched
    expect(output).toContain("3 files touched");
    // And the output reports 2 blocker plus major findings
    expect(output).toContain("2 blocker plus major findings");
  });

  it("counts duplicate file paths as one touched file", () => {
    // Given three findings all in src/a.ts
    const findings = [
      makeFinding("minor", "src/a.ts"),
      makeFinding("info", "src/a.ts"),
      makeFinding("nitpick", "src/a.ts"),
    ];

    // When renderMetricChips is called
    const output = renderMetricChips()(findings);

    // Then the output reports 3 findings
    expect(output).toContain("3 findings");
    // And the output reports 1 file touched
    expect(output).toContain("1 file touched");
    // And the output reports 0 blocker plus major findings
    expect(output).toContain("0 blocker plus major findings");
  });

  it("renders zero-valued metrics for empty findings", () => {
    // Given there are no findings
    const findings: readonly Finding[] = [];

    // When renderMetricChips is called
    const output = renderMetricChips()(findings);

    // Then the output reports 0 findings
    expect(output).toContain("0 findings");
    // And the output reports 0 files touched
    expect(output).toContain("0 files touched");
    // And the output reports 0 blocker plus major findings
    expect(output).toContain("0 blocker plus major findings");
  });
});
