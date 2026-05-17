// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/render.ts",
  line_start: 12,
  line_end: 12,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
  source: "llm",
  confidence: 0.87,
};

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  pr_number: 36,
  repo_full_name: "mpiton/sovri",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-17T08:00:00.000Z"),
  completed_at: new Date("2026-05-17T08:01:00.000Z"),
  llm_provider: "test-provider",
  llm_model: "test-model",
  tokens_used: {
    prompt: 1200,
    completion: 300,
  },
  summary: "The PR has actionable review findings.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("composeWalkthrough escaped sections", () => {
  it("keeps escaped file paths safe in findings and file-by-file sections", () => {
    // Given the review contains a finding for file "src/<unsafe>&pipes|name.ts"
    // And the finding line_start is 7
    // And the finding line_end is 7
    // And the finding title is "Validate admin | reviewer role"
    // And the finding body is "The role value `admin | reviewer` is rendered inside a table."
    const review: Review = {
      ...baseReview,
      findings: [
        {
          ...baseFinding,
          file: "src/<unsafe>&pipes|name.ts",
          line_start: 7,
          line_end: 7,
          title: "Validate admin | reviewer role",
          body: "The role value `admin | reviewer` is rendered inside a table.",
        },
      ],
    };

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);
    const findingsSection = extractSection(markdown, "### Findings");
    const fileByFileSection = extractSection(markdown, "### File-by-file");

    // Then the Findings section contains "src/&lt;unsafe&gt;&amp;pipes\\|name.ts:7"
    expect(findingsSection).toContain("src/&lt;unsafe&gt;&amp;pipes\\|name.ts:7");
    // And the File-by-file section contains "src/&lt;unsafe&gt;&amp;pipes\\|name.ts"
    expect(fileByFileSection).toContain("src/&lt;unsafe&gt;&amp;pipes\\|name.ts");
    // And the markdown contains "Validate admin \\| reviewer role"
    expect(markdown).toContain("Validate admin \\| reviewer role");
    // And the findings table still has exactly the columns "Severity", "Location", "Title", and "Details"
    expect(findTableRowCells(findingsSection, "| Severity ")).toEqual([
      "Severity",
      "Location",
      "Title",
      "Details",
    ]);
    expect(findTableRowCells(findingsSection, "| Major ")).toHaveLength(4);
  });
});

function extractSection(markdown: string, heading: string): string {
  const headingStart = markdown.indexOf(heading);

  if (headingStart < 0) {
    throw new Error(`Missing walkthrough section: ${heading}`);
  }

  const sectionStart = headingStart + heading.length;
  const section = markdown.slice(sectionStart);
  const nextSectionStart = section.indexOf("\n### ");

  return nextSectionStart < 0 ? section : section.slice(0, nextSectionStart);
}

function findTableRowCells(section: string, rowPrefix: string): string[] {
  const row = section.split("\n").find((line) => line.startsWith(rowPrefix));

  if (row === undefined) {
    throw new Error(`Missing findings table row: ${rowPrefix}`);
  }

  return row
    .split(/(?<!\\)\|/u)
    .slice(1, -1)
    .map((cell) => cell.trim());
}
