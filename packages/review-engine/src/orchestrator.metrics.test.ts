// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

// Acceptance test for the Sovri business metrics emitted by the orchestrator (GitHub issue #2419,
// R-01..R-10). Mirrors specs/task-128-business-metrics/business-metrics.feature.
//
// Metric emission is observed by capturing the `recordMetric` export of @sovri/observability. The
// orchestrator owns three of the five metrics — sovri.reviews.total, sovri.reviews.duration_ms, and
// sovri.findings.total. The two provider-side metrics (sovri.llm.tokens, sovri.llm.errors) are emitted
// inside the adapter and are covered by the co-located provider test, because by the time the
// orchestrator sees a provider failure the typed error class has already been flattened to a message
// (so error_type can only be class-derived at the adapter). withSpan stays real: telemetry is
// uninitialized, so it is a transparent no-op. @sovri/core is never mocked (R-10).

import { ReviewSchema, z, type Diff, type Finding, type PullRequest } from "@sovri/core";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reviewPullRequest, type ReviewPullRequestConfig } from "./orchestrator.js";

// --- recordMetric capture ---------------------------------------------------

interface MetricCall {
  readonly name: string;
  readonly kind: string;
  readonly value: number;
  readonly tags: Record<string, string>;
}

const metrics = vi.hoisted(() => {
  const calls: MetricCall[] = [];
  let throwMode = false;
  function recordMetric(
    descriptor: { name: string; kind: string },
    value: number,
    tags?: Record<string, string>,
  ): void {
    // Record first, then optionally throw: a metrics failure must never abort the review (R-09),
    // and the test still needs proof that emission was attempted (not vacuously skipped).
    calls.push({ name: descriptor.name, kind: descriptor.kind, value, tags: { ...tags } });
    if (throwMode) {
      throw new Error("metrics backend exploded");
    }
  }
  return {
    calls,
    recordMetric,
    setThrowMode(value: boolean): void {
      throwMode = value;
    },
    reset(): void {
      calls.length = 0;
      throwMode = false;
    },
  };
});

vi.mock("@sovri/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sovri/observability")>();
  return { ...actual, recordMetric: metrics.recordMetric };
});

beforeEach(() => {
  metrics.reset();
});

// --- helpers ----------------------------------------------------------------

function callsFor(name: string): MetricCall[] {
  return metrics.calls.filter((call) => call.name === name);
}

function metricNames(): string[] {
  return [...new Set(metrics.calls.map((call) => call.name))].toSorted();
}

function allTagText(): string {
  return metrics.calls
    .map(
      (call) =>
        `${call.name}|${Object.entries(call.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")}`,
    )
    .join("\n");
}

// --- fixtures ---------------------------------------------------------------

const METRIC = {
  reviewsTotal: "sovri.reviews.total",
  reviewsDuration: "sovri.reviews.duration_ms",
  findingsTotal: "sovri.findings.total",
  llmTokens: "sovri.llm.tokens",
  llmErrors: "sovri.llm.errors",
} as const;

interface ProviderResponseShape {
  readonly summary: string;
  readonly findings: ReadonlyArray<Record<string, unknown>>;
  readonly walkthrough_markdown: string;
}

function majorFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: "major",
    category: "bug",
    file: "packages/review-engine/src/orchestrator.ts",
    line_start: 42,
    line_end: 42,
    title: "Missing orchestration guard",
    body: "The orchestration path should preserve the complete Review contract.",
    recommendation: "Add a guard to verify the orchestration result before returning it.",
    confidence: 0.91,
    // CWE-20 maps to a framework, so the finding clears the compliance-only publication gate and the
    // findings.total metric assertions still observe a published finding.
    cwe: "CWE-20",
    ...overrides,
  };
}

function responseWith(findingCount: number): ProviderResponseShape {
  return {
    summary: `${String(findingCount)} findings.`,
    findings: Array.from({ length: findingCount }, (_unused, index) =>
      majorFinding({
        line_start: 42 + index,
        line_end: 42 + index,
        title: `Finding ${String(index)}`,
      }),
    ),
    walkthrough_markdown: "## Sovri review\n\nfindings.",
  };
}

// A provider that returns a valid structured review with N findings and reports token usage.
class SuccessProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;

  constructor(private readonly response: ProviderResponseShape = responseWith(1)) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return params.schema.parse(this.response);
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<{ data: T; tokenUsage: { prompt: number; completion: number } }> {
    return {
      data: params.schema.parse(this.response),
      tokenUsage: { prompt: 1200, completion: 340 },
    };
  }
}

// Throws a real ZodError -> the orchestrator rethrows it unchanged (the error/finally branch).
class ZodThrowProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;

  async generateStructured<T>(): Promise<T> {
    return z.number().parse("not a number") as T;
  }
}

// Throws a retryable schema failure on every attempt -> failureKind "parse" -> the orchestrator
// RETURNS a failed descriptor carrying one synthetic review_failed Finding (findings.count === 1).
class ParseFailureProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;

  async generateStructured<T>(): Promise<T> {
    throw new RetryableProviderError("schema invalid, retry");
  }
}

class RetryableProviderError extends Error {
  public override readonly name = "RetryableProviderError";
  public readonly retryableWithCorrectivePrompt = true;
}

const pullRequest: PullRequest = {
  number: 128,
  repo_full_name: "mpiton/sovri",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/business-metrics",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Implement business metrics",
  body: "Emit the five sovri.* business metrics.",
  additions: 1,
  deletions: 1,
  changed_files: 1,
};

function oneFileDiff(unifiedDiff = "@@ -40,3 +40,3 @@\n-old\n+new\n"): Diff {
  return {
    unified_diff: unifiedDiff,
    files: [
      {
        path: "packages/review-engine/src/orchestrator.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        sha: "cccccccccccccccccccccccccccccccccccccccc",
        patch: "@@ -40,3 +40,3 @@\n-old\n+new",
        hunks: [
          {
            old_start: 40,
            old_lines: 3,
            new_start: 40,
            new_lines: 3,
            header: "@@ -40,3 +40,3 @@",
            lines: [" ctx", "-old", "+new"],
          },
        ],
      },
    ],
  };
}

const baseConfig: ReviewPullRequestConfig = {
  review: { severityThreshold: "major" },
  ignores: [],
  limits: { maxFilesPerReview: 5, maxLinesPerReview: 50 },
};
const noFilesConfig: ReviewPullRequestConfig = { ...baseConfig, ignores: ["**"] };
const limitConfig: ReviewPullRequestConfig = {
  ...baseConfig,
  limits: { maxFilesPerReview: 0, maxLinesPerReview: 50 },
};

type ReviewResult = Awaited<ReturnType<typeof reviewPullRequest>>;

async function capture(
  input: { pullRequest: PullRequest; diff: Diff; config: ReviewPullRequestConfig },
  options: Parameters<typeof reviewPullRequest>[1],
): Promise<{ value?: ReviewResult; error?: unknown }> {
  try {
    return { value: await reviewPullRequest(input, options) };
  } catch (error) {
    return { error };
  }
}

function normalizeReview(value: ReviewResult | undefined): string {
  const json = JSON.stringify(value, (key, val: unknown) =>
    key === "id" || key === "started_at" || key === "completed_at" ? undefined : val,
  );
  return json.replace(/SOVRI-[A-Z]{2}-[0-9A-F]{4}-[0-9A-F]{4}/gu, "SOVRI-REF");
}

// --- R-01 -------------------------------------------------------------------

describe("R-01 — a successful review emits the orchestrator metrics with the right names and kinds", () => {
  it("emits reviews.total (counter), reviews.duration_ms (histogram), findings.total (counter) and no llm.* or other names", async () => {
    // Given the diff has 1 reviewable file after ignore filters
    // And the provider returns one "major" finding and reports token usage prompt 1200, completion 340
    // When the review-engine runs reviewPullRequest to a successful completion
    const { value } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );
    expect(value).toBeDefined();

    // Then recordMetric is called for exactly the three orchestrator metric names and no others
    expect(metricNames()).toEqual(
      [METRIC.findingsTotal, METRIC.reviewsDuration, METRIC.reviewsTotal].toSorted(),
    );

    // And the kinds are counter / histogram as declared in the registry
    expect(callsFor(METRIC.reviewsTotal).every((c) => c.kind === "counter")).toBe(true);
    expect(callsFor(METRIC.reviewsDuration).every((c) => c.kind === "histogram")).toBe(true);
    expect(callsFor(METRIC.findingsTotal).every((c) => c.kind === "counter")).toBe(true);

    // And on this successful path llm.errors is not emitted by the orchestrator
    expect(callsFor(METRIC.llmErrors)).toHaveLength(0);
  });
});

// --- R-02 -------------------------------------------------------------------

describe("R-02 — each orchestrator metric carries exactly its fixed tag-key set", () => {
  it("reviews.total has {status, llm_provider}, duration has {llm_provider}, findings has {severity, category, source}", async () => {
    // Given a successful review with one finding
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    expect(Object.keys(callsFor(METRIC.reviewsTotal)[0]?.tags ?? {}).toSorted()).toEqual([
      "llm_provider",
      "status",
    ]);
    expect(Object.keys(callsFor(METRIC.reviewsDuration)[0]?.tags ?? {})).toEqual(["llm_provider"]);
    expect(Object.keys(callsFor(METRIC.findingsTotal)[0]?.tags ?? {}).toSorted()).toEqual([
      "category",
      "severity",
      "source",
    ]);
  });
});

// --- R-04 -------------------------------------------------------------------

describe("R-04 — findings.total tag values come straight from the validated Finding", () => {
  it("tags severity, category, source from the Finding and llm_provider from the provider name", async () => {
    // Given the provider returns one Finding with severity "major", category "bug", source "llm"
    const { value } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then findings.total carries the Finding's own enum values
    const finding = callsFor(METRIC.findingsTotal)[0];
    expect(finding?.tags).toEqual({ severity: "major", category: "bug", source: "llm" });

    // And those values match the Finding actually returned in the descriptor
    const returned = ReviewSchema.parse(value).findings.at(0) as Finding | undefined;
    expect(returned?.severity).toBe(finding?.tags["severity"]);
    expect(returned?.category).toBe(finding?.tags["category"]);

    // And llm_provider on reviews.total is the provider name
    expect(callsFor(METRIC.reviewsTotal)[0]?.tags["llm_provider"]).toBe("test-provider");
  });
});

// --- R-05 -------------------------------------------------------------------

describe("R-05 — reviews.total and reviews.duration_ms are emitted exactly once per review", () => {
  it("a successful review emits each once with status succeeded and a non-negative duration", async () => {
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    expect(callsFor(METRIC.reviewsTotal)).toHaveLength(1);
    expect(callsFor(METRIC.reviewsTotal)[0]?.tags).toEqual({
      status: "succeeded",
      llm_provider: "test-provider",
    });
    expect(callsFor(METRIC.reviewsDuration)).toHaveLength(1);
    expect(callsFor(METRIC.reviewsDuration)[0]?.tags).toEqual({ llm_provider: "test-provider" });
    expect(callsFor(METRIC.reviewsDuration)[0]?.value).toBeGreaterThanOrEqual(0);
  });

  it("a throwing review still records reviews.total status failed and duration once, and rethrows", async () => {
    // Given the provider raises an error while generating the review
    const { value, error } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new ZodThrowProvider() },
    );

    // Then reviewPullRequest rejects with that error, unchanged
    expect(value).toBeUndefined();
    expect(error).toBeInstanceOf(z.ZodError);

    // And reviews.total/duration are still emitted exactly once (recorded in the finally branch)
    expect(callsFor(METRIC.reviewsTotal)).toHaveLength(1);
    expect(callsFor(METRIC.reviewsTotal)[0]?.tags).toEqual({
      status: "failed",
      llm_provider: "test-provider",
    });
    expect(callsFor(METRIC.reviewsDuration)).toHaveLength(1);
  });
});

// --- R-05 / R-06 (early-return branches) ------------------------------------

describe("R-05/R-06 — early-return branches emit reviews.* once and no LLM-call metrics", () => {
  it.each([
    { branch: "no-files", config: noFilesConfig, status: "succeeded" },
    { branch: "limit-exceeded", config: limitConfig, status: "failed" },
  ])(
    "$branch emits reviews.total once (status $status), duration once, 0 tokens, 0 findings",
    async ({ config, status }) => {
      // Given the review returns early via the branch path before any LLM call
      await capture(
        { pullRequest, diff: oneFileDiff(), config },
        { provider: new SuccessProvider() },
      );

      // Then reviews.total is emitted exactly once with the branch status, duration once
      expect(callsFor(METRIC.reviewsTotal)).toHaveLength(1);
      expect(callsFor(METRIC.reviewsTotal)[0]?.tags).toEqual({
        status,
        llm_provider: "test-provider",
      });
      expect(callsFor(METRIC.reviewsDuration)).toHaveLength(1);

      // And no LLM-call metrics and no findings are emitted on the pre-LLM branches
      expect(callsFor(METRIC.llmTokens)).toHaveLength(0);
      expect(callsFor(METRIC.findingsTotal)).toHaveLength(0);
    },
  );
});

// --- R-06 -------------------------------------------------------------------

describe("R-06 — findings.total fires once per emitted Finding", () => {
  it.each([{ findings: 0 }, { findings: 1 }, { findings: 3 }])(
    "$findings findings -> findings.total emitted $findings times",
    async ({ findings }) => {
      // Given the provider returns <findings> findings
      await capture(
        { pullRequest, diff: oneFileDiff(), config: baseConfig },
        { provider: new SuccessProvider(responseWith(findings)) },
      );

      // Then findings.total is emitted exactly <findings> times
      expect(callsFor(METRIC.findingsTotal)).toHaveLength(findings);
      // And each emission has value 1 (one increment per finding)
      expect(callsFor(METRIC.findingsTotal).every((c) => c.value === 1)).toBe(true);
    },
  );

  it("a parse-failure descriptor counts its synthetic review_failed Finding once", async () => {
    // Given the provider fails schema parsing on every attempt (failureKind "parse")
    const { value } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new ParseFailureProvider() },
    );
    expect(value).toBeDefined();

    // Then findings.total fires once for the one synthetic Finding the descriptor surfaces
    const findings = callsFor(METRIC.findingsTotal);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.tags).toEqual({
      severity: "major",
      category: "bug",
      source: "llm",
    });
    // And reviews.total still records the failed review exactly once
    expect(callsFor(METRIC.reviewsTotal)).toHaveLength(1);
    expect(callsFor(METRIC.reviewsTotal)[0]?.tags["status"]).toBe("failed");
  });
});

// --- R-07 -------------------------------------------------------------------

describe("R-07 — no sensitive value ever appears in a metric name or tag", () => {
  it("keeps diff, prompt, response, and key markers out of every emitted metric", async () => {
    // Given leak markers in the diff, the PR title/body, the response, and on the provider
    const leakyResponse = responseWith(1);
    const leaky: ProviderResponseShape = {
      ...leakyResponse,
      summary: "LEAK_RESPONSE_C0D4 summary",
      findings: [majorFinding({ title: "LEAK_RESPONSE_C0D4", body: "LEAK_RESPONSE_C0D4 body" })],
    };
    const leakyPr: PullRequest = {
      ...pullRequest,
      title: "Add LEAK_PROMPT_2B19 handling",
      body: "Body mentions LEAK_PROMPT_2B19.",
    };

    // When the review-engine runs reviewPullRequest to a successful completion
    await capture(
      {
        pullRequest: leakyPr,
        diff: oneFileDiff("@@ -1 +1 @@\n-old\n+LEAK_DIFF_7F3A\n"),
        config: baseConfig,
      },
      { provider: new SuccessProvider(leaky) },
    );

    // Then metrics were actually emitted (the check is not vacuous)
    expect(metrics.calls.length).toBeGreaterThan(0);

    // And no captured metric name or tag value contains a marker, and no tag key is a forbidden dimension
    const text = allTagText();
    for (const marker of ["LEAK_DIFF_7F3A", "LEAK_PROMPT_2B19", "LEAK_RESPONSE_C0D4"]) {
      expect(text).not.toContain(marker);
    }
    const tagKeys = new Set(metrics.calls.flatMap((c) => Object.keys(c.tags)));
    for (const forbidden of ["pr_number", "delivery_id", "repo", "branch", "title", "path"]) {
      expect(tagKeys.has(forbidden)).toBe(false);
    }
  });
});

// --- R-09 -------------------------------------------------------------------

describe("R-09 — a metrics failure never disturbs the review", () => {
  it("returns an identical descriptor whether recordMetric throws or is a no-op", async () => {
    // Baseline: metrics on, recordMetric does not throw
    const baseline = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );
    metrics.reset();

    // Given recordMetric throws when called
    metrics.setThrowMode(true);
    const withThrow = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then emission was attempted (not silently skipped)
    expect(metrics.calls.length).toBeGreaterThan(0);
    // And the review still completed successfully with an unchanged descriptor
    expect(withThrow.error).toBeUndefined();
    expect(withThrow.value).toBeDefined();
    expect(normalizeReview(withThrow.value)).toEqual(normalizeReview(baseline.value));
  });
});

// --- R-02 / R-03 / R-08 / R-10 (registry, dynamically imported) -------------

describe("R-02/R-03/R-08/R-10 — the review-engine metric registry and typed wrappers", () => {
  it("rejects an unknown tag key on a wrapper and emits nothing (R-02)", async () => {
    const registry = await import("./metrics.js");
    metrics.reset();
    registry.recordReviewTotal({
      status: "succeeded",
      llm_provider: "test-provider",
      repo: "mpiton/sovri",
    } as never);
    expect(callsFor(METRIC.reviewsTotal)).toHaveLength(0);
  });

  it.each([{ status: "cancelled" }, { status: "succeeded", llm_provider: 12 }])(
    "rejects an out-of-enum / wrong-typed status value and emits nothing (R-03)",
    async (bag) => {
      const registry = await import("./metrics.js");
      metrics.reset();
      registry.recordReviewTotal(bag as never);
      expect(callsFor(METRIC.reviewsTotal)).toHaveLength(0);
    },
  );

  it.each([
    { severity: "critical", category: "bug", source: "llm" },
    { severity: "major", category: "bug", source: "heuristic" },
  ])("rejects a finding tag value outside the core enum and emits nothing (R-03)", async (bag) => {
    const registry = await import("./metrics.js");
    metrics.reset();
    registry.recordFinding(bag as never);
    expect(callsFor(METRIC.findingsTotal)).toHaveLength(0);
  });

  it("emits via the typed wrapper with the registry name and kind for a valid tag bag (R-08)", async () => {
    const registry = await import("./metrics.js");
    metrics.reset();
    registry.recordReviewTotal({ status: "succeeded", llm_provider: "test-provider" });
    expect(callsFor(METRIC.reviewsTotal)).toHaveLength(1);
    expect(callsFor(METRIC.reviewsTotal)[0]?.kind).toBe("counter");
  });

  it("the metrics source carries the SPDX header and uses no type/lint escapes (R-10)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./metrics.ts", import.meta.url), "utf8");
    expect(
      source.startsWith(
        "// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sovri contributors",
      ),
    ).toBe(true);
    expect(source).not.toMatch(/@ts-(ignore|expect-error)/u);
    expect(source).not.toMatch(/oxlint-disable/u);
    for (const relativeImport of source.match(/from\s+"\.[^"]*"/gu) ?? []) {
      expect(relativeImport).toMatch(/\.js"$/u);
    }
  });
});
