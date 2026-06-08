// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { brandAssetUrls } from "@sovri/brand";
import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 10,
  line_end: 10,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
  recommendation: "Validate the payload before reading it.",
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
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "One review finding needs attention.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

const headerImage = `![Sovri code review](${brandAssetUrls.reviewCommentHeader})`;
const footerImage = `![Sovri](${brandAssetUrls.reviewCommentFooter})`;

describe("composeWalkthrough brand banners", () => {
  it("omits the brand banners by default (ADR-016 text-only header)", () => {
    const markdown = composeWalkthrough(baseReview);

    expect(markdown).not.toContain(brandAssetUrls.reviewCommentHeader);
    expect(markdown).not.toContain(brandAssetUrls.reviewCommentFooter);
    // The verdict heading remains the first line when no banner is requested.
    expect(markdown.startsWith("## ")).toBe(true);
  });

  it("prepends the header banner above the verdict heading when brandHeader is on", () => {
    const markdown = composeWalkthrough(baseReview, { brandHeader: true });

    const lines = markdown.split("\n");
    expect(lines[0]).toBe(headerImage);
    // The banner sits above, never replaces, the deterministic verdict heading.
    expect(markdown.indexOf(headerImage)).toBeLessThan(markdown.indexOf("## "));
    expect(markdown).not.toContain(brandAssetUrls.reviewCommentFooter);
  });

  it("appends the footer banner as the last line when brandFooter is on", () => {
    const markdown = composeWalkthrough(baseReview, { brandFooter: true });

    const lines = markdown.split("\n");
    expect(lines.at(-1)).toBe(footerImage);
    expect(markdown).not.toContain(brandAssetUrls.reviewCommentHeader);
  });

  it("wraps the walkthrough with both banners when both flags are on", () => {
    const markdown = composeWalkthrough(baseReview, { brandHeader: true, brandFooter: true });

    const lines = markdown.split("\n");
    expect(lines[0]).toBe(headerImage);
    expect(lines.at(-1)).toBe(footerImage);
    // Core content survives between the banners.
    expect(markdown).toContain("## ");
    expect(markdown).toContain("### TL;DR");
    expect(markdown).toContain("### File-by-file");
  });
});
