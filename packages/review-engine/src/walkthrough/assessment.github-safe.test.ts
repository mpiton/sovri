// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review, Severity } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, renderAssessmentBlock } from "./index.js";

const HTML_TAG_PATTERN = /<\/?[a-z][a-z0-9:-]*(?:\s[^>]*)?\/?>/iu;

let findingSeq = 0;

function makeFinding(severity: Severity, file: string): Finding {
  findingSeq += 1;
  const hex = findingSeq.toString(16).padStart(12, "0");
  return {
    id: `88888888-8888-4888-8888-${hex}`,
    severity,
    category: "bug",
    file,
    line_start: findingSeq,
    line_end: findingSeq,
    title: `${severity} finding ${findingSeq}`,
    body: `Body ${findingSeq}.`,
    recommendation: `Fix finding ${findingSeq}.`,
    source: "llm",
    confidence: 0.8,
  };
}

function baseReview(findings: readonly Finding[]): Review {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    pr_number: 36,
    repo_full_name: "mpiton/sovri",
    commit_sha: "a".repeat(40),
    started_at: new Date("2026-05-17T08:00:00.000Z"),
    completed_at: new Date("2026-05-17T08:01:00.000Z"),
    llm_provider: "test-provider",
    llm_model: "test-model",
    tokens_used: { prompt: 1200, completion: 300 },
    summary: "Assessment block should render safely.",
    findings,
    walkthrough_markdown: "Previous provider walkthrough.",
    status: "success",
  };
}

describe("assessment GitHub-safe markdown (R-08)", () => {
  it("inserts the assessment block after the verdict header in canonical order", () => {
    // Given a review with 4 findings across 3 files
    const review = baseReview([
      makeFinding("blocker", "src/auth.ts"),
      makeFinding("major", "src/review.ts"),
      makeFinding("minor", "src/review.ts"),
      makeFinding("info", "src/docs.ts"),
    ]);

    // When composeWalkthrough is called
    const output = composeWalkthrough(review);

    // Then the canonical block order is preserved
    expect(blockIndex(output, "## ❌ Request changes")).toBeLessThan(
      blockIndex(output, "### Review assessment"),
    );
    expect(blockIndex(output, "### Review assessment")).toBeLessThan(
      blockIndex(output, "### TL;DR"),
    );
    expect(blockIndex(output, "### TL;DR")).toBeLessThan(blockIndex(output, "### Findings"));
    expect(blockIndex(output, "### Findings")).toBeLessThan(blockIndex(output, "### File-by-file"));
  });

  it("emits no CSS, stripped GitHub attributes, or external stylesheet references", () => {
    // Given a review with blocker, major, minor, and info findings
    const findings = [
      makeFinding("blocker", "src/auth.ts"),
      makeFinding("major", "src/review.ts"),
      makeFinding("minor", "src/review.ts"),
      makeFinding("info", "src/docs.ts"),
    ];

    // When renderAssessmentBlock is called
    const output = renderAssessmentBlock(findings).join("\n");

    // Then the block stays GitHub-safe markdown text
    expect(output).not.toContain("class=");
    expect(output).not.toContain("style=");
    expect(output.toLowerCase()).not.toContain("<style");
    expect(output.toLowerCase()).not.toContain("stylesheet");
    expect(output).not.toMatch(/https?:\/\//u);
    expect(output).not.toMatch(HTML_TAG_PATTERN);
    expect("<div>").toMatch(HTML_TAG_PATTERN);
    expect('<span class="metric">').toMatch(HTML_TAG_PATTERN);
  });

  it("does not emit local preview vocabulary as markup", () => {
    // Given a review with 3 findings
    const findings = [
      makeFinding("major", "src/review.ts"),
      makeFinding("minor", "src/review.ts"),
      makeFinding("nitpick", "src/docs.ts"),
    ];

    // When renderAssessmentBlock is called
    const output = renderAssessmentBlock(findings).join("\n");

    // Then no local preview CSS vocabulary is rendered
    expect(output).not.toContain(".dots");
    expect(output).not.toContain(".metric");
    expect(output).not.toContain(".sevbar");
    expect(output).not.toContain(".sevlegend");
  });
});

function blockIndex(output: string, block: string): number {
  expect(output, `Expected walkthrough markdown to contain block: ${block}`).toContain(block);
  return output.indexOf(block);
}
