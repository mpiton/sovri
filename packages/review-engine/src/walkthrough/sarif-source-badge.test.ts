// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for rule R-10 (SARIF findings surfaced in Checks rows and the
// walkthrough): SARIF findings are counted in the "Sovri / review" row, the
// "Sovri / license-scan" row stays the v1.0 neutral placeholder, SARIF findings
// are attributed via a source badge in the title cell, and every SARIF-derived
// string is escaped through formatTableCell.

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { buildReviewCheckDescriptors } from "../checks/index.js";
import { sourceBadge } from "./badge.js";
import { renderFindings } from "./sections.js";

let idSeq = 0;
function makeFinding(overrides: Partial<Finding> & Pick<Finding, "source">): Finding {
  idSeq += 1;
  const suffix = String(idSeq).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    severity: "major",
    category: "security",
    file: "src/a.ts",
    line_start: 1,
    line_end: 1,
    title: "finding",
    body: "body",
    recommendation: "fix it",
    confidence: 0.9,
    compliance_references: [],
    ...overrides,
  };
}

function reviewWith(findings: Finding[]): Pick<Review, "findings" | "status"> {
  return { status: "success", findings };
}

function descriptorNamed(
  descriptors: ReturnType<typeof buildReviewCheckDescriptors>,
  name: string,
) {
  const descriptor = descriptors.find((candidate) => candidate.name === name);
  if (descriptor === undefined) {
    throw new Error(`descriptor ${name} not found`);
  }
  return descriptor;
}

describe("SARIF output surfacing — R-10", () => {
  it("counts SARIF findings in the Sovri / review Checks row", () => {
    // Given a review with 2 LLM findings and 3 surfaced SARIF findings
    const findings = [
      makeFinding({ source: "llm" }),
      makeFinding({ source: "llm" }),
      makeFinding({ source: "sarif" }),
      makeFinding({ source: "sarif" }),
      makeFinding({ source: "sarif" }),
    ];

    // When the Checks rows are mapped
    const reviewRow = descriptorNamed(
      buildReviewCheckDescriptors(reviewWith(findings)),
      "Sovri / review",
    );

    // Then the "Sovri / review" row reflects all 5 findings
    expect(reviewRow.summary).toContain("5");
  });

  it("keeps the license-scan Checks row at the neutral placeholder", () => {
    // Given a review that surfaced 3 SARIF findings
    const findings = [
      makeFinding({ source: "sarif" }),
      makeFinding({ source: "sarif" }),
      makeFinding({ source: "sarif" }),
    ];

    // When the Checks rows are mapped
    const licenseRow = descriptorNamed(
      buildReviewCheckDescriptors(reviewWith(findings)),
      "Sovri / license-scan",
    );

    // Then it stays the v1.0 neutral placeholder
    expect(licenseRow.conclusion).toBe("neutral");
    expect(licenseRow.summary).toBe("License scan available in v1.0");
  });

  it("attributes a SARIF finding with a source badge, an LLM finding with none", () => {
    // Given a SARIF finding and an LLM finding
    expect(sourceBadge({ source: "sarif" })).toContain("SARIF");
    expect(sourceBadge({ source: "llm" })).toBe("");

    // When the findings table is rendered
    const sarifTable = renderFindings([
      makeFinding({ source: "sarif", title: "SQL injection" }),
    ]).join("\n");
    const llmTable = renderFindings([makeFinding({ source: "llm", title: "SQL injection" })]).join(
      "\n",
    );

    // Then the SARIF title cell carries the source badge and the LLM one does not
    expect(sarifTable).toContain("SARIF");
    expect(llmTable).not.toContain("SARIF");
  });

  it("escapes a SARIF-derived title with markdown control characters", () => {
    // Given a surfaced SARIF finding whose title is "evil | ](http://x) <img src=x>"
    const finding = makeFinding({ source: "sarif", title: "evil | ](http://x) <img src=x>" });

    // When the findings table is rendered
    const table = renderFindings([finding]).join("\n");

    // Then the pipe, bracket and angle-bracket characters are escaped
    expect(table).toContain("\\|");
    expect(table).toContain("&lt;img");
    expect(table).not.toContain("<img src=x>");
  });
});
