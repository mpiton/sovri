// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { Finding, Review } from "@sovri/core";
import { describe, expect, it } from "vitest";

import { composeWalkthrough, type WalkthroughInput } from "./index.js";

// Rule R-09 (runtime slice) — adversarial finding content is escaped, never emitted as live HTML or
// CSS, and the rendered walkthrough carries no credential. (The static slices — no `any`, SPDX
// headers, ESM `.js` imports — are enforced by the non-business gates, not by this test.)

const baseFinding: Finding = {
  id: "11111111-1111-4111-8111-111111111111",
  severity: "major",
  category: "bug",
  file: "src/review.ts",
  line_start: 18,
  line_end: 18,
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
  tokens_used: { prompt: 1200, completion: 300 },
  summary: "Review completed.",
  findings: [baseFinding],
  walkthrough_markdown: "Previous provider walkthrough.",
  status: "success",
};

describe("walkthrough output safety (R-09)", () => {
  it("escapes a finding body carrying CSS and HTML markup instead of activating it", () => {
    // Given a finding whose body is "<style>.x{}</style> nice class=evil try"
    const review: Review = {
      ...baseReview,
      findings: [{ ...baseFinding, body: "<style>.x{}</style> nice class=evil try" }],
    };

    // When the walkthrough is composed
    const markdown = composeWalkthrough(review as unknown as WalkthroughInput);

    // Then the body is rendered as escaped text in its table cell
    expect(markdown).toContain("&lt;style&gt;.x{}&lt;/style&gt; nice class=evil try");
    // And no active style/script element from finding content survives
    expect(markdown).not.toContain("<style");
    expect(markdown).not.toContain("<script");
    // And the only raw tags are the GitHub-safe provenance details wrapper,
    // so the "class=evil" text cannot become an active HTML attribute
    expect(markdown.match(/<\/?[A-Za-z][^>]*>/gu) ?? []).toEqual([
      "<details>",
      "<summary>",
      "</summary>",
      "</details>",
    ]);
    expect(markdown).not.toMatch(/<[^>]*(?:class|style)=/u);
  });

  it("sources no credential of its own — an out-of-band secret never reaches the output", () => {
    // composeWalkthrough is a pure function of its Review: it has no token/key/webhook parameter
    // and reads no environment, so a secret that lives only outside the Review cannot leak.
    // (Secrets embedded in user-controlled Review fields are the bot's responsibility upstream;
    //  the composer escapes and renders those fields, it does not introduce credentials itself.)
    const outOfBandSecret = `ghp_${"a".repeat(36)}`;
    process.env["SOVRI_OUTPUT_SAFETY_FIXTURE"] = outOfBandSecret;

    try {
      // When the walkthrough is composed from a Review carrying no secret
      const markdown = composeWalkthrough(baseReview as unknown as WalkthroughInput);

      // Then the out-of-band secret never appears, nor any GitHub-token / LLM-key / webhook marker
      expect(markdown).not.toContain(outOfBandSecret);
      expect(markdown).not.toMatch(/ghp_[A-Za-z0-9]{36}/u);
      expect(markdown).not.toMatch(/sk-[A-Za-z0-9]{20,}/u);
      expect(markdown).not.toContain("X-Hub-Signature");
    } finally {
      delete process.env["SOVRI_OUTPUT_SAFETY_FIXTURE"];
    }
  });
});
