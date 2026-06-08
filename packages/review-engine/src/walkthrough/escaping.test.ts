// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough } from "./index.js";

type EscapedField = "summary" | "finding title" | "finding body" | "finding file";

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/render.ts",
  line_start: 12,
  line_end: 12,
  title: "Missing payload null guard",
  body: "The review payload is read before validation.",
  recommendation: "Add a null check on the payload before accessing its properties.",
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

describe("composeWalkthrough HTML escaping", () => {
  it.each([
    {
      field: "summary",
      raw: "Found <script>alert(1)</script> & comments",
      escaped: "Found &lt;script&gt;alert(1)&lt;/script&gt; &amp; comments",
      forbidden: "<script>",
    },
    {
      field: "finding title",
      raw: "Avoid <b>trusted</b> HTML",
      escaped: "Avoid &lt;b&gt;trusted&lt;/b&gt; HTML",
      forbidden: "<b>",
    },
    {
      field: "finding body",
      raw: "Use <strong>escaped</strong> text & validate.",
      escaped: "Use &lt;strong&gt;escaped&lt;/strong&gt; text &amp; validate.",
      forbidden: "<strong>",
    },
    {
      field: "finding file",
      raw: "src/<unsafe>&pipes|name.ts",
      escaped: "src/&lt;unsafe&gt;&amp;pipes\\|name.ts",
      forbidden: "src/<unsafe>&pipes|name.ts",
    },
  ] satisfies ReadonlyArray<{
    readonly field: EscapedField;
    readonly raw: string;
    readonly escaped: string;
    readonly forbidden: string;
  }>)("escapes user-controlled $field before rendering", ({ field, raw, escaped, forbidden }) => {
    // Given the review has <field> set to <raw>
    // And the review contains a major finding for file "src/render.ts"
    // And the finding line_start is 12
    // And the finding line_end is 12
    const review = reviewWithField(field, raw);

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);

    // Then the markdown contains <escaped>
    expect(markdown).toContain(escaped);
    // And the markdown does not contain <forbidden>
    expect(markdown).not.toContain(forbidden);
  });

  it("escapes raw HTML copied from a finding body", () => {
    // Given the review contains a finding for file "src/render.ts"
    // And the finding line_start is 12
    // And the finding line_end is 12
    // And the finding body is "Render <img src=x onerror=alert(1)> directly"
    const review = reviewWithField("finding body", "Render <img src=x onerror=alert(1)> directly");

    // When the maintainer calls `composeWalkthrough(review)`
    const markdown = composeWalkthrough(review);

    // Then the markdown must not contain "<img src=x onerror=alert(1)>"
    expect(markdown).not.toContain("<img src=x onerror=alert(1)>");
    // And the markdown contains "Render &lt;img src=x onerror=alert(1)&gt; directly"
    expect(markdown).toContain("Render &lt;img src=x onerror=alert(1)&gt; directly");
  });
});

function reviewWithField(field: EscapedField, raw: string): Review {
  switch (field) {
    case "summary":
      return {
        ...baseReview,
        summary: raw,
      };
    case "finding title":
      return {
        ...baseReview,
        findings: [
          {
            ...baseFinding,
            title: raw,
          },
        ],
      };
    case "finding body":
      return {
        ...baseReview,
        findings: [
          {
            ...baseFinding,
            body: raw,
          },
        ],
      };
    case "finding file":
      return {
        ...baseReview,
        findings: [
          {
            ...baseFinding,
            file: raw,
          },
        ],
      };
  }
}
