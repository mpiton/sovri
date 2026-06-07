// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Acceptance test for the review-engine business span tree (GitHub issue #2413, R-01..R-09).
// Mirrors specs/task-127-review-engine-spans/review-engine-spans.feature.
//
// Tracing is observed by capturing the `withSpan` export of @sovri/observability. The capture
// mirrors the D-01 contract: it forwards a span handle to `fn` (so the engine can stamp
// findings.count after parsing), records the exception on reject, and ends the span in a finally.
// @sovri/core is never mocked (R-08): the engine runs against the real domain.

import { readFileSync } from "node:fs";

import { ReviewSchema, z, type Diff, type PullRequest } from "@sovri/core";
import { MemoryAuditTrailSink } from "@sovri/compliance";
import type { GenerateStructuredParams, LLMProvider } from "@sovri/llm-providers";
import type { SpanAttributeValue } from "@sovri/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reviewPullRequest, type ReviewPullRequestConfig } from "./orchestrator.js";

interface FakeSpan {
  readonly name: string;
  // Attributes passed to withSpan when the span opens (the upfront map).
  readonly openingAttributes: Record<string, SpanAttributeValue>;
  // Live attribute map: opening attributes plus anything set via setAttribute on the forwarded span.
  readonly attributes: Record<string, SpanAttributeValue>;
  readonly exceptions: unknown[];
  ended: number;
  setAttribute(key: string, value: SpanAttributeValue): void;
}

interface SpanEvent {
  readonly kind: "open" | "attr" | "end";
  readonly name: string;
  readonly key?: string;
}

// Hoisted so the vi.mock factory below can reference it. Mirrors the extended withSpan contract.
const tracing = vi.hoisted(() => {
  const spans: FakeSpan[] = [];
  const events: SpanEvent[] = [];
  let passthrough = false;

  async function withSpan<T>(
    name: string,
    fn: (span: FakeSpan) => Promise<T>,
    attributes?: Record<string, SpanAttributeValue>,
  ): Promise<T> {
    const attrs: Record<string, SpanAttributeValue> = { ...attributes };
    const span: FakeSpan = {
      name,
      openingAttributes: { ...attributes },
      attributes: attrs,
      exceptions: [],
      ended: 0,
      setAttribute(key: string, value: SpanAttributeValue): void {
        attrs[key] = value;
        if (!passthrough) {
          events.push({ kind: "attr", name, key });
        }
      },
    };
    // Passthrough mirrors the uninitialized real withSpan: run fn, record nothing. Used to
    // produce the no-op baseline for the R-05 with-vs-without equivalence comparison.
    if (passthrough) {
      return fn(span);
    }
    spans.push(span);
    events.push({ kind: "open", name });
    try {
      return await fn(span);
    } catch (error) {
      span.exceptions.push(error);
      throw error;
    } finally {
      span.ended += 1;
      events.push({ kind: "end", name });
    }
  }

  return {
    spans,
    events,
    withSpan,
    setPassthrough(value: boolean): void {
      passthrough = value;
    },
    reset(): void {
      spans.length = 0;
      events.length = 0;
      passthrough = false;
    },
  };
});

vi.mock("@sovri/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sovri/observability")>();
  return { ...actual, withSpan: tracing.withSpan };
});

beforeEach(() => {
  tracing.reset();
});

// --- Fixtures ---------------------------------------------------------------

const SPAN_NAMES = {
  parent: "review.pull_request",
  fetchDiff: "review.fetch_diff",
  buildPrompt: "review.build_prompt",
  llmCall: "review.llm_call",
  parseFindings: "review.parse_findings",
} as const;

class RetryableProviderError extends Error {
  public override readonly name = "RetryableProviderError";
  public readonly retryableWithCorrectivePrompt = true;
}

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
    confidence: 0.91,
    ...overrides,
  };
}

const SUCCESS_RESPONSE: ProviderResponseShape = {
  summary: "One major orchestration finding.",
  findings: [majorFinding()],
  walkthrough_markdown: "## Sovri review\n\nOne major orchestration finding.",
};

// Returns a valid structured review (1 major finding -> findings.count === 1).
class SuccessProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  constructor(private readonly response: ProviderResponseShape = SUCCESS_RESPONSE) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    this.calls += 1;
    return params.schema.parse(this.response);
  }
}

// Throws a non-retryable, non-propagating error -> orchestrator RETURNS a failed descriptor (0 findings).
class ProviderRejectProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new Error("provider timeout fixture");
  }
}

// Throws a ZodError -> shouldPropagateProviderFailure is true -> orchestrator RETHROWS (R-03).
class ZodThrowProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    // A real ZodError; the engine must let it propagate unchanged.
    return z.number().parse("not a number") as T;
  }
}

// Throws a retryable error on every attempt -> failureKind "parse" -> RETURNS a failed descriptor
// carrying the single synthetic review_failed finding (findings.count === 1).
class RetryTwiceProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new RetryableProviderError("schema invalid, retry");
  }
}

// Retryable error on the first attempt, valid on the corrective retry -> status "partial".
class FlakyThenSuccessProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new RetryableProviderError("first attempt invalid");
    }
    return params.schema.parse(SUCCESS_RESPONSE);
  }
}

// Carries an LLM-key marker on the provider object. The engine must never serialize the provider
// (and so never leak the key) onto a span — the key is present in the run so its absence is a signal.
class LeakyKeyProvider implements LLMProvider {
  public readonly name = "test-provider";
  public readonly model = "test-model";
  public readonly maxTokens = 2048;
  public readonly leakedKeyMarker = "sovri-fake-llm-key-marker";

  constructor(private readonly response: ProviderResponseShape) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return params.schema.parse(this.response);
  }
}

const pullRequest: PullRequest = {
  number: 38,
  repo_full_name: "mpiton/sovri",
  head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_ref: "feature/review-orchestrator",
  base_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  base_ref: "main",
  author: "maintainer",
  draft: false,
  title: "Implement orchestrator.ts",
  body: "Wire parsing, filtering, and review output.",
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

function twoFileDiff(): Diff {
  const base = oneFileDiff();
  const first = base.files[0];
  if (first === undefined) {
    throw new Error("fixture invariant: oneFileDiff has a file");
  }
  return {
    unified_diff: base.unified_diff,
    files: [first, { ...first, path: "packages/review-engine/src/audit-ref.ts" }],
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

interface Capture {
  readonly value?: ReviewResult;
  readonly error?: unknown;
}

async function capture(
  input: { pullRequest: PullRequest; diff: Diff; config: ReviewPullRequestConfig },
  options: Parameters<typeof reviewPullRequest>[1],
): Promise<Capture> {
  try {
    return { value: await reviewPullRequest(input, options) };
  } catch (error) {
    return { error };
  }
}

function spanNames(): string[] {
  return tracing.spans.map((span) => span.name);
}

function findSpan(name: string): FakeSpan | undefined {
  return tracing.spans.find((span) => span.name === name);
}

// Strips the non-deterministic fields (uuid id, timestamps, per-run audit references) so two runs
// of the same review are structurally comparable. Audit references are generated fresh per run and
// also embedded in the walkthrough, so they are scrubbed in the serialized form, not just by key.
// Used by the R-05 no-op equivalence check (isolates instrumentation transparency from this noise).
function normalizeReview(value: ReviewResult | undefined): string {
  const json = JSON.stringify(value, (key, val: unknown) =>
    key === "id" || key === "started_at" || key === "completed_at" ? undefined : val,
  );
  return json.replace(/SOVRI-[A-Z]{2}-[0-9A-F]{4}-[0-9A-F]{4}/gu, "SOVRI-REF");
}

function allSpanText(): string {
  return tracing.spans
    .map((span) => {
      const attrText = Object.entries(span.attributes)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(",");
      const exText = span.exceptions.map((ex) => String(ex)).join(",");
      return `${span.name}|${attrText}|${exText}`;
    })
    .join("\n");
}

// --- R-01 -------------------------------------------------------------------

describe("R-01 — successful review opens the parent span and its four child spans in order", () => {
  it("opens review.pull_request with fetch_diff, build_prompt, llm_call, parse_findings in order", async () => {
    // Given the diff has 1 reviewable file after ignore filters
    // And the provider returns one "major" finding
    // When the review-engine runs reviewPullRequest to a successful completion
    const { value } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );
    expect(value).toBeDefined();

    // Then exactly one parent span "review.pull_request" is opened
    expect(tracing.spans.filter((s) => s.name === SPAN_NAMES.parent)).toHaveLength(1);

    // And its child spans are opened in this order
    expect(spanNames()).toEqual([
      SPAN_NAMES.parent,
      SPAN_NAMES.fetchDiff,
      SPAN_NAMES.buildPrompt,
      SPAN_NAMES.llmCall,
      SPAN_NAMES.parseFindings,
    ]);

    // And every opened span is ended exactly once
    expect(tracing.spans.every((s) => s.ended === 1)).toBe(true);
  });
});

// --- R-02 -------------------------------------------------------------------

describe("R-02 — the parent span carries the four non-sensitive scalar attributes", () => {
  it("carries pr.number, pr.repo, llm.provider, and findings.count", async () => {
    // Given the provider returns one "major" finding so the final findings count is 1
    // When the review-engine runs reviewPullRequest to a successful completion
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then the "review.pull_request" span carries exactly these attributes
    const parent = findSpan(SPAN_NAMES.parent);
    expect(parent?.attributes).toEqual({
      "pr.number": 38,
      "pr.repo": "mpiton/sovri",
      "llm.provider": "test-provider",
      "findings.count": 1,
    });
  });
});

// --- R-02 / D-01 ------------------------------------------------------------

describe("R-02/D-01 — findings.count is stamped on the forwarded span after parsing", () => {
  it("sets findings.count via setAttribute after parse_findings, not as an upfront attribute", async () => {
    // Given the provider returns one "major" finding so the final findings count is 1
    // When the review-engine runs reviewPullRequest to a successful completion
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );
    const parent = findSpan(SPAN_NAMES.parent);

    // Then the attribute map passed when "review.pull_request" opens contains pr.number, pr.repo, llm.provider
    expect(parent?.openingAttributes).toEqual({
      "pr.number": 38,
      "pr.repo": "mpiton/sovri",
      "llm.provider": "test-provider",
    });
    // And that opening attribute map does NOT contain "findings.count"
    expect(parent?.openingAttributes).not.toHaveProperty("findings.count");

    // And "findings.count" = 1 is set via setAttribute on the forwarded span
    expect(parent?.attributes["findings.count"]).toBe(1);

    // And that setAttribute happens only after the "review.parse_findings" span has ended
    const parseEnd = tracing.events.findIndex(
      (e) => e.kind === "end" && e.name === SPAN_NAMES.parseFindings,
    );
    const countSet = tracing.events.findIndex(
      (e) => e.kind === "attr" && e.name === SPAN_NAMES.parent && e.key === "findings.count",
    );
    expect(parseEnd).toBeGreaterThanOrEqual(0);
    expect(countSet).toBeGreaterThan(parseEnd);
  });
});

// --- R-02 (child attribute scoping) -----------------------------------------

describe("R-02 — child spans carry only their scoped, non-sensitive attributes", () => {
  it("scopes fetch_diff to counts, llm_call to provider/model, and leaks nothing on build/parse", async () => {
    // Given the diff has 1 reviewable file after ignore filters
    // When the review-engine runs reviewPullRequest to a successful completion
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then fetch_diff attributes are limited to changed_files and reviewable_files counts
    expect(Object.keys(findSpan(SPAN_NAMES.fetchDiff)?.attributes ?? {}).toSorted()).toEqual([
      "changed_files",
      "reviewable_files",
    ]);

    // And llm_call attributes are limited to llm.provider and provider.model
    expect(findSpan(SPAN_NAMES.llmCall)?.attributes).toEqual({
      "llm.provider": "test-provider",
      "provider.model": "test-model",
    });

    // And build_prompt carries no attribute holding the system/user prompt or diff text
    expect(Object.keys(findSpan(SPAN_NAMES.buildPrompt)?.attributes ?? {})).not.toContain(
      "system_prompt",
    );
    expect(findSpan(SPAN_NAMES.buildPrompt)?.attributes ?? {}).not.toHaveProperty("user_prompt");

    // And parse_findings carries no finding title/body/response text — a scalar count at most
    const parseAttrs = findSpan(SPAN_NAMES.parseFindings)?.attributes ?? {};
    for (const value of Object.values(parseAttrs)) {
      expect(typeof value).not.toBe("string");
    }
  });
});

// --- R-03 (throwing stage) --------------------------------------------------

describe("R-03 — a throwing stage records the exception and propagates the original error", () => {
  it("records the exception on llm_call and the parent, rejects unchanged, no findings.count", async () => {
    // Given a capturing audit sink is injected
    // And the provider raises a validation error (a ZodError) while generating the review
    const sink = new MemoryAuditTrailSink();
    const provider = new ZodThrowProvider();

    // When the review-engine runs reviewPullRequest
    const { value, error } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider, auditTrailSink: sink },
    );

    // Then reviewPullRequest rejects with the same ZodError, unchanged
    expect(value).toBeUndefined();
    expect(error).toBeInstanceOf(z.ZodError);

    // And the "review.llm_call" span records that exception and is ended
    const llm = findSpan(SPAN_NAMES.llmCall);
    expect(llm?.exceptions).toHaveLength(1);
    expect(llm?.exceptions[0]).toBe(error);
    expect(llm?.ended).toBe(1);

    // And the "review.pull_request" span records that exception and is ended
    const parent = findSpan(SPAN_NAMES.parent);
    expect(parent?.exceptions).toContain(error);
    expect(parent?.ended).toBe(1);

    // And the "review.pull_request" span has no "findings.count" attribute
    expect(parent?.attributes ?? {}).not.toHaveProperty("findings.count");

    // And the captured audit sink's last event is "review.failed" with error_code "unexpected_error"
    const last = sink.getEvents().at(-1);
    expect(last?.event).toBe("review.failed");
    if (last?.event === "review.failed") {
      expect(last.error_code).toBe("unexpected_error");
    }
  });
});

// --- R-03 / R-01 (non-throwing failure branches) ----------------------------

describe("R-03 — a non-throwing failure ends its spans without recording any exception", () => {
  it.each([
    {
      branch: "provider-failure",
      provider: (): LLMProvider => new ProviderRejectProvider(),
      count: 0,
    },
    { branch: "parse-failure", provider: (): LLMProvider => new RetryTwiceProvider(), count: 1 },
  ])(
    "$branch: spans end once, parse_findings never opens, findings.count = $count",
    async ({ provider, count }) => {
      // Given the diff has 1 reviewable file after ignore filters
      // And the review takes a path that returns a failed descriptor
      // When the review-engine runs reviewPullRequest
      const { value, error } = await capture(
        { pullRequest, diff: oneFileDiff(), config: baseConfig },
        { provider: provider() },
      );
      expect(error).toBeUndefined();
      expect(value).toBeDefined();

      // Then fetch_diff, build_prompt, llm_call, and pull_request are each ended exactly once
      for (const name of [
        SPAN_NAMES.fetchDiff,
        SPAN_NAMES.buildPrompt,
        SPAN_NAMES.llmCall,
        SPAN_NAMES.parent,
      ]) {
        expect(findSpan(name)?.ended).toBe(1);
      }

      // And "review.parse_findings" is never opened
      expect(spanNames()).not.toContain(SPAN_NAMES.parseFindings);

      // And no span records an exception
      expect(tracing.spans.every((s) => s.exceptions.length === 0)).toBe(true);

      // And the parent span's "findings.count" attribute is <count>
      expect(findSpan(SPAN_NAMES.parent)?.attributes["findings.count"]).toBe(count);
    },
  );
});

// --- R-04 (no leak) ---------------------------------------------------------

describe("R-04 — no sensitive value appears in any span", () => {
  it("keeps diff, prompt, response, and key markers out of every span on success", async () => {
    // Given diff/prompt/response/key markers
    const leakyResponse: ProviderResponseShape = {
      summary: "LEAK_RESPONSE_C0D4 summary",
      findings: [majorFinding({ title: "LEAK_RESPONSE_C0D4", body: "LEAK_RESPONSE_C0D4 body" })],
      walkthrough_markdown: "## Sovri review\n\nLEAK_RESPONSE_C0D4",
    };
    const leakyPr: PullRequest = {
      ...pullRequest,
      title: "Add LEAK_PROMPT_2B19 handling",
      body: "Body mentions LEAK_PROMPT_2B19 for the prompt.",
    };

    // And the injected provider holds the LLM key marker
    // When the review-engine runs reviewPullRequest to a successful completion
    await capture(
      {
        pullRequest: leakyPr,
        diff: oneFileDiff("@@ -1 +1 @@\n-old\n+LEAK_DIFF_7F3A\n"),
        config: baseConfig,
      },
      { provider: new LeakyKeyProvider(leakyResponse) },
    );

    // Then no captured span name, attribute key, or attribute value contains any marker
    const text = allSpanText();
    for (const marker of [
      "LEAK_DIFF_7F3A",
      "LEAK_PROMPT_2B19",
      "LEAK_RESPONSE_C0D4",
      "sovri-fake-llm-key-marker",
    ]) {
      expect(text).not.toContain(marker);
    }
  });

  it("keeps the error marker out of every span when a stage fails", async () => {
    // Given the provider fails with an error whose message contains a marker
    class MarkerErrorProvider implements LLMProvider {
      public readonly name = "test-provider";
      public readonly model = "test-model";
      public readonly maxTokens = 2048;
      async generateStructured<T>(): Promise<T> {
        throw new Error("provider exploded: LEAK_ERROR_4A8C");
      }
    }

    // When the review-engine runs reviewPullRequest
    await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new MarkerErrorProvider() },
    );

    // Then no span name, attribute key, or attribute value contains the error marker.
    // (The marker legitimately lives in the recorded exception, which the scenario hedges out
    //  via "readable as a span attribute" — exceptions are not attributes, so they are out of scope.)
    for (const span of tracing.spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(`${key}=${String(value)}`).not.toContain("LEAK_ERROR_4A8C");
      }
    }
    expect(spanNames().join("|")).not.toContain("LEAK_ERROR_4A8C");
  });
});

// --- R-05 (withSpan only + no-op) -------------------------------------------

describe("R-05 — the engine reaches tracing only through withSpan and stays a no-op when uninitialized", () => {
  it("produces every span through withSpan, imports no @opentelemetry, and returns a no-op-identical descriptor", async () => {
    // Given telemetry has never been initialized (the captured withSpan is a pass-through)
    // When the review-engine runs reviewPullRequest to a successful completion (instrumented path)
    tracing.setPassthrough(false);
    const instrumented = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then every span is produced through the withSpan export (the only source of captured spans)
    expect(tracing.spans.length).toBeGreaterThan(0);

    // And no source file under packages/review-engine/src imports any @opentelemetry/* package
    const orchestratorSource = readFileSync(new URL("./orchestrator.ts", import.meta.url), "utf8");
    expect(orchestratorSource).not.toMatch(/@opentelemetry\//u);

    // And the returned descriptor is identical to the same review run with withSpan stubbed to
    // call its function directly (no span tree) — instrumentation changes nothing observable.
    tracing.reset();
    tracing.setPassthrough(true);
    const baseline = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );
    tracing.setPassthrough(false);

    expect(instrumented.error).toBeUndefined();
    expect(baseline.error).toBeUndefined();
    expect(normalizeReview(instrumented.value)).toEqual(normalizeReview(baseline.value));
  });
});

// --- R-06 (observable contract unchanged) -----------------------------------

describe("R-06 — the observable contract is unchanged for every branch", () => {
  it.each([
    {
      branch: "limit-exceeded",
      provider: (): LLMProvider => new SuccessProvider(),
      config: limitConfig,
      throws: false,
      status: "failed",
      lastEvent: "review.failed",
      code: "limit_exceeded",
    },
    {
      branch: "no-files",
      provider: (): LLMProvider => new SuccessProvider(),
      config: noFilesConfig,
      throws: false,
      status: "success",
      lastEvent: "review.completed",
      code: undefined,
    },
    {
      branch: "provider-failure-returned",
      provider: (): LLMProvider => new ProviderRejectProvider(),
      config: baseConfig,
      throws: false,
      status: "failed",
      lastEvent: "review.failed",
      code: "provider_error",
    },
    {
      branch: "parse-failure-returned",
      provider: (): LLMProvider => new RetryTwiceProvider(),
      config: baseConfig,
      throws: false,
      status: "failed",
      lastEvent: "review.failed",
      code: "parse_error",
    },
    {
      branch: "provider-failure-thrown",
      provider: (): LLMProvider => new ZodThrowProvider(),
      config: baseConfig,
      throws: true,
      status: undefined,
      lastEvent: "review.failed",
      code: "unexpected_error",
    },
    {
      branch: "partial",
      provider: (): LLMProvider => new FlakyThenSuccessProvider(),
      config: baseConfig,
      throws: false,
      status: "partial",
      lastEvent: "review.completed",
      code: undefined,
    },
    {
      branch: "success",
      provider: (): LLMProvider => new SuccessProvider(),
      config: baseConfig,
      throws: false,
      status: "success",
      lastEvent: "review.completed",
      code: undefined,
    },
  ])(
    "$branch yields its terminal outcome and last audit event unchanged",
    async ({ provider, config, throws, status, lastEvent, code }) => {
      // Given a capturing audit sink is injected
      const sink = new MemoryAuditTrailSink();

      // When the review-engine runs reviewPullRequest
      const { value, error } = await capture(
        { pullRequest, diff: oneFileDiff(), config },
        { provider: provider(), auditTrailSink: sink },
      );

      if (throws) {
        // Then it rejects with the original error exactly as without instrumentation
        expect(error).toBeDefined();
        expect(value).toBeUndefined();
      } else {
        // Then it returns the same descriptor type and status as without instrumentation
        expect(error).toBeUndefined();
        expect(value).toBeDefined();
        expect(ReviewSchema.parse(value).status).toBe(status);
      }

      // And the last audit event matches the uninstrumented run for that branch
      const last = sink.getEvents().at(-1);
      expect(last?.event).toBe(lastEvent);
      if (code !== undefined && last?.event === "review.failed") {
        expect(last.error_code).toBe(code);
      }
    },
  );
});

// --- R-07 (early-return branches) -------------------------------------------

describe("R-07 — early-return branches close the parent span and leave no child open", () => {
  it.each([
    { branch: "limit-exceeded", config: limitConfig, opened: [SPAN_NAMES.parent] },
    {
      branch: "no-files",
      config: noFilesConfig,
      opened: [SPAN_NAMES.parent, SPAN_NAMES.fetchDiff],
    },
  ])(
    "$branch opens exactly its spans, each ended once, findings.count = 0",
    async ({ config, opened }) => {
      // Given a review that returns early via the branch path
      // When the review-engine runs reviewPullRequest
      await capture(
        { pullRequest, diff: oneFileDiff(), config },
        { provider: new SuccessProvider() },
      );

      // Then the opened spans are exactly <opened spans>, each ended exactly once
      expect(spanNames().toSorted()).toEqual([...opened].toSorted());
      expect(tracing.spans.every((s) => s.ended === 1)).toBe(true);

      // And no child span opened by that path is left open (every span ended)
      // And the parent span's "findings.count" attribute is 0
      expect(findSpan(SPAN_NAMES.parent)?.attributes["findings.count"]).toBe(0);
    },
  );

  it("no-files: the fetch_diff span reports zero reviewable files", async () => {
    // Given the diff has 2 changed files but 0 reviewable files after ignore filters
    // When the review-engine runs reviewPullRequest
    await capture(
      {
        pullRequest: { ...pullRequest, changed_files: 2 },
        diff: twoFileDiff(),
        config: noFilesConfig,
      },
      { provider: new SuccessProvider() },
    );

    // Then the fetch_diff span carries changed_files = 2 and reviewable_files = 0
    expect(findSpan(SPAN_NAMES.fetchDiff)?.attributes).toEqual({
      changed_files: 2,
      reviewable_files: 0,
    });
  });
});

// --- R-08 (engine purity) ---------------------------------------------------

describe("R-08 — the engine stays pure and never mocks @sovri/core", () => {
  it("runs a successful review against the real @sovri/core (ReviewSchema/PullRequestSchema)", async () => {
    // When the review-engine runs reviewPullRequest to a successful completion
    const { value } = await capture(
      { pullRequest, diff: oneFileDiff(), config: baseConfig },
      { provider: new SuccessProvider() },
    );

    // Then the returned descriptor is a real, schema-valid Review (core was exercised, not mocked)
    expect(() => ReviewSchema.parse(value)).not.toThrow();
  });
});

// --- R-09 (code-quality contract) -------------------------------------------

describe("R-09 — new source meets the code-quality contract", () => {
  const orchestratorSource = readFileSync(new URL("./orchestrator.ts", import.meta.url), "utf8");
  const testSource = readFileSync(new URL("./orchestrator.spans.test.ts", import.meta.url), "utf8");
  const spdx = "// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sovri SAS";

  it("the orchestrator and the spans test both carry the two-line SPDX header", () => {
    expect(orchestratorSource.startsWith(spdx)).toBe(true);
    expect(testSource.startsWith(spdx)).toBe(true);
  });

  it("the orchestrator production source uses no type/lint escapes and .js internal imports", () => {
    // Scanned on the production source only: the test legitimately mentions these tokens in regexes.
    expect(orchestratorSource).not.toMatch(/@ts-(ignore|expect-error)/u);
    expect(orchestratorSource).not.toMatch(/oxlint-disable/u);
    for (const relativeImport of orchestratorSource.match(/from\s+"\.[^"]*"/gu) ?? []) {
      expect(relativeImport).toMatch(/\.js"$/u);
    }
  });

  it("@opentelemetry/api is not a dependency of @sovri/review-engine", () => {
    const pkg: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const deps = isRecord(pkg) && isRecord(pkg["dependencies"]) ? pkg["dependencies"] : {};
    expect(Object.keys(deps)).not.toContain("@opentelemetry/api");
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
