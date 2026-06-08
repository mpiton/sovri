// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import { ReviewSchema, type Review } from "./Review.js";

const baseReview: Review = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  pr_number: 42,
  repo_full_name: "sovri/example",
  commit_sha: "a".repeat(40),
  started_at: new Date("2026-05-14T10:00:00.000Z"),
  completed_at: new Date("2026-05-14T10:01:00.000Z"),
  llm_provider: "anthropic",
  llm_model: "claude-sonnet-4",
  tokens_used: {
    prompt: 1234,
    completion: 567,
  },
  summary: "Review completed successfully.",
  findings: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      severity: "major",
      category: "bug",
      file: "src/index.ts",
      line_start: 10,
      line_end: 12,
      title: "Possible null dereference",
      body: "Variable `foo` may be `null` here because the early-return guard only checks `bar`.",
      recommendation:
        "Add a null check for `foo` before dereferencing it, or extend the early-return guard to cover both `foo` and `bar`.",
      source: "llm",
      confidence: 0.85,
      compliance_references: [],
    },
  ],
  walkthrough_markdown: "## Sovri review\n\n1 finding.",
  status: "success",
};

describe("ReviewSchema — happy paths", () => {
  it("accepts a valid completed review", () => {
    expect(ReviewSchema.parse(baseReview)).toEqual(baseReview);
  });

  it("accepts an optional error message", () => {
    const parsed = ReviewSchema.parse({
      ...baseReview,
      status: "partial",
      error: "LLM retry budget exhausted after partial parsing.",
    });

    expect(parsed.error).toBe("LLM retry budget exhausted after partial parsing.");
  });

  it("accepts zero token counts", () => {
    const parsed = ReviewSchema.parse({
      ...baseReview,
      tokens_used: { prompt: 0, completion: 0 },
    });

    expect(parsed.tokens_used).toEqual({ prompt: 0, completion: 0 });
  });

  it("accepts an explicit provider token usage signal", () => {
    const parsed = ReviewSchema.parse({
      ...baseReview,
      token_usage_reported: true,
    });

    expect(parsed.token_usage_reported).toBe(true);
  });
});

describe("ReviewSchema — commit_sha", () => {
  it("rejects a commit sha shorter than 40 characters", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, commit_sha: "a".repeat(39) }).success).toBe(
      false,
    );
  });

  it("rejects a commit sha longer than 40 characters", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, commit_sha: "a".repeat(41) }).success).toBe(
      false,
    );
  });

  it("rejects a 40-character non-hex commit sha", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, commit_sha: "g".repeat(40) }).success).toBe(
      false,
    );
  });
});

describe("ReviewSchema — repo_full_name", () => {
  it("rejects a repository name without owner and repo segments", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, repo_full_name: "example" }).success).toBe(
      false,
    );
  });

  it("rejects a repository name with control characters", () => {
    expect(
      ReviewSchema.safeParse({ ...baseReview, repo_full_name: "sovri/example\nother" }).success,
    ).toBe(false);
  });

  it("rejects an empty repository segment", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, repo_full_name: "sovri/" }).success).toBe(false);
  });

  it("rejects a repository segment longer than 100 characters", () => {
    expect(
      ReviewSchema.safeParse({ ...baseReview, repo_full_name: `sovri/${"a".repeat(101)}` }).success,
    ).toBe(false);
  });
});

describe("ReviewSchema — temporal bounds", () => {
  it("accepts started_at equal to completed_at", () => {
    const timestamp = new Date("2026-05-14T10:00:00.000Z");
    const parsed = ReviewSchema.parse({
      ...baseReview,
      started_at: timestamp,
      completed_at: timestamp,
    });

    expect(parsed.started_at).toBe(timestamp);
    expect(parsed.completed_at).toBe(timestamp);
  });

  it("rejects started_at after completed_at", () => {
    expect(
      ReviewSchema.safeParse({
        ...baseReview,
        started_at: new Date("2026-05-14T10:02:00.000Z"),
        completed_at: new Date("2026-05-14T10:01:00.000Z"),
      }).success,
    ).toBe(false);
  });
});

describe("ReviewSchema — tokens_used", () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid prompt token count %p",
    (value) => {
      expect(
        ReviewSchema.safeParse({
          ...baseReview,
          tokens_used: { ...baseReview.tokens_used, prompt: value },
        }).success,
      ).toBe(false);
    },
  );

  it.each([-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid completion token count %p",
    (value) => {
      expect(
        ReviewSchema.safeParse({
          ...baseReview,
          tokens_used: { ...baseReview.tokens_used, completion: value },
        }).success,
      ).toBe(false);
    },
  );
});

describe("ReviewSchema — status", () => {
  it.each(["success", "partial", "failed"] satisfies readonly Review["status"][])(
    "accepts %s",
    (status) => {
      expect(ReviewSchema.parse({ ...baseReview, status }).status).toBe(status);
    },
  );

  it("rejects an unknown status", () => {
    expect(ReviewSchema.safeParse({ ...baseReview, status: "pending" }).success).toBe(false);
  });
});

describe("ReviewSchema — required field omissions", () => {
  const requiredKeys = [
    "id",
    "pr_number",
    "repo_full_name",
    "commit_sha",
    "started_at",
    "completed_at",
    "llm_provider",
    "llm_model",
    "tokens_used",
    "summary",
    "findings",
    "walkthrough_markdown",
    "status",
  ] as const;

  it.each(requiredKeys)("rejects a review missing %s", (key) => {
    const broken = { ...baseReview } as Record<string, unknown>;
    delete broken[key];
    expect(ReviewSchema.safeParse(broken).success).toBe(false);
  });
});

describe("ReviewSchema — type inference", () => {
  it("infers a Review whose runtime parse round-trips", () => {
    const review: Review = { ...baseReview };

    expect(ReviewSchema.parse(review)).toEqual(review);
  });
});
