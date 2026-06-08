// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { MemoryAuditTrailSink, type AuditTrailLogicalEvent } from "@sovri/compliance";
import { z, type Category, type Diff, type PullRequest, type Severity } from "@sovri/core";
import type {
  GenerateStructuredParams,
  LLMProvider,
  StructuredGeneration,
} from "@sovri/llm-providers";
import { createLogger } from "@sovri/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computePromptSha256 } from "./audit-events.js";
import { reviewPullRequest } from "./orchestrator.js";
import { WalkthroughInputSchema } from "./walkthrough/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// --- fixtures (concrete values mirror the Gherkin scenarios) -----------------

const COMMIT_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const AUDIT_REFERENCE_PATTERN = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/u;

const pullRequest: PullRequest = {
  number: 4242,
  repo_full_name: "acme-corp/payments",
  head_sha: COMMIT_SHA,
  head_ref: "feature/charge",
  base_sha: "0000000000000000000000000000000000000000",
  base_ref: "main",
  author: "engineer",
  draft: false,
  title: "Charge endpoint",
  body: "Add charge handler.",
  additions: 10,
  deletions: 2,
  changed_files: 1,
};

const diff: Diff = buildDiff(" const amount = req.body.amount;");

const config = {
  review: { severityThreshold: "nitpick" as Severity },
  ignores: [] as readonly string[],
  limits: { maxFilesPerReview: 50, maxLinesPerReview: 5000 },
};

// --- provider + finding fixtures ---------------------------------------------

interface RawFindingFixture {
  readonly severity: Severity;
  readonly category: Category;
  readonly file: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly title: string;
  readonly body: string;
  readonly recommendation: string;
  readonly confidence: number;
  readonly cwe?: string;
}

function rawFinding(overrides: Partial<RawFindingFixture> = {}): RawFindingFixture {
  return {
    severity: "major",
    category: "bug",
    file: "src/payments/charge.ts",
    line_start: 12,
    line_end: 12,
    title: "Missing validation",
    body: "The charge amount is used without validation.",
    recommendation:
      "Validate the charge amount against allowed bounds before processing the payment.",
    confidence: 0.9,
    ...overrides,
  };
}

interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

class FindingsProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  constructor(
    private readonly findings: readonly RawFindingFixture[],
    private readonly tokenUsage: TokenUsage = { prompt: 812, completion: 144 },
  ) {}

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    this.calls += 1;

    return {
      data: params.schema.parse({
        summary: "Charge review.",
        findings: this.findings,
        walkthrough_markdown: "## Sovri review\n\nCharge review.",
      }),
      tokenUsage: this.tokenUsage,
    };
  }
}

// Provider that must never be reached (limit / no-files paths). Calling it fails loudly.
class NeverCalledProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new Error("provider must not be called");
  }
}

// Returns a response object that FAILS ProviderReviewResponseSchema, so the
// orchestrator's re-parse throws. A response WAS returned -> llm.called must fire.
class UnparseableProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(): Promise<StructuredGeneration<T>> {
    this.calls += 1;
    // Cast: simulate a malformed provider response (empty summary violates the
    // schema's min(1)); the orchestrator re-parses and rejects it.
    const malformed = { summary: "", findings: [], walkthrough_markdown: "x" } as unknown as T;

    return { data: malformed, tokenUsage: { prompt: 600, completion: 40 } };
  }
}

// Call 1 returns malformed data (response returned), call 2 returns one valid finding.
class MalformedThenValidProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;
  public readonly systemPrompts: string[] = [];
  public readonly userPrompts: string[] = [];

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<StructuredGeneration<T>> {
    this.calls += 1;
    this.systemPrompts.push(params.systemPrompt);
    this.userPrompts.push(params.userPrompt);

    if (this.calls === 1) {
      // Cast: malformed first response that triggers the corrective retry.
      const malformed = { summary: "", findings: [] } as unknown as T;

      return { data: malformed, tokenUsage: { prompt: 600, completion: 0 } };
    }

    return {
      data: params.schema.parse({
        summary: "Corrected review.",
        findings: [rawFinding()],
        walkthrough_markdown: "## Sovri review\n\nCorrected review.",
      }),
      tokenUsage: { prompt: 300, completion: 80 },
    };
  }
}

// Throws with no response at all (transport failure) -> no llm.called.
class TransportErrorProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new Error("provider transport failure");
  }
}

// Call 1 returns malformed data (a response WAS received), call 2 throws a transport
// error. The review fails as a provider error, but llm.called must still be recorded
// because tokens were charged on the first response.
class MalformedThenTransportErrorProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(): Promise<StructuredGeneration<T>> {
    this.calls += 1;
    if (this.calls === 1) {
      // Cast: malformed first response that triggers the corrective retry.
      const malformed = { summary: "", findings: [] } as unknown as T;

      return { data: malformed, tokenUsage: { prompt: 600, completion: 0 } };
    }
    throw new Error("provider transport failure on retry");
  }
}

// Throws an error whose message echoes PR content (a provider SDK error that quotes the
// request). The audit error_message must not persist it.
class SecretEchoingProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  constructor(private readonly secret: string) {}

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new Error(`provider rejected request containing ${this.secret}`);
  }
}

// A retryable schema-validation error that carries token usage — what real provider
// adapters throw when the model responded but its structured output was invalid.
class RetryableSchemaError extends Error {
  readonly retryableWithCorrectivePrompt = true;
  readonly tokenUsage = { prompt: 700, completion: 0 };
}

// Throws a token-bearing retryable schema error on every attempt: the model responded
// (tokens charged) but failed schema validation both times.
class TokenBearingSchemaErrorProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    return (await this.generateStructuredWithUsage(params)).data;
  }

  async generateStructuredWithUsage<T>(): Promise<StructuredGeneration<T>> {
    this.calls += 1;
    throw new RetryableSchemaError("provider schema validation failed");
  }
}

// Throws a ZodError, which the orchestrator propagates (re-throws).
class PropagatingProvider implements LLMProvider {
  public readonly name = "anthropic";
  public readonly model = "claude-sonnet-4-6";
  public readonly maxTokens = 2048;
  public calls = 0;

  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    const result = z.number().safeParse("not-a-number");
    if (result.success) {
      throw new Error("unreachable");
    }
    throw result.error;
  }
}

// --- sinks -------------------------------------------------------------------

class AlwaysFailingSink {
  async append(): Promise<void> {
    throw new Error("sink storage unavailable");
  }
}

class FailFirstEventSink {
  readonly delegate = new MemoryAuditTrailSink();

  async append(event: AuditTrailLogicalEvent): Promise<void> {
    if (event.event === "review.started") {
      throw new Error("sink storage unavailable for review.started");
    }
    await this.delegate.append(event);
  }

  getEvents(): readonly AuditTrailLogicalEvent[] {
    return this.delegate.getEvents();
  }
}

// --- helpers -----------------------------------------------------------------

function eventTypes(sink: MemoryAuditTrailSink | FailFirstEventSink): readonly string[] {
  return sink.getEvents().map((event) => event.event);
}

// Cast: read fields off a discriminated-union event for assertion convenience.
function findEvent(
  sink: MemoryAuditTrailSink | FailFirstEventSink,
  type: string,
): Record<string, unknown> | undefined {
  return sink.getEvents().find((event) => event.event === type) as
    | Record<string, unknown>
    | undefined;
}

// =============================================================================

describe("reviewPullRequest audit-trail sink wiring", () => {
  // --- R-01 ------------------------------------------------------------------
  describe("R-01 options stay backward compatible", () => {
    it("the pre-existing options shape still produces a review", async () => {
      const provider = new FindingsProvider([rawFinding()]);

      // Given review options that set only the required "provider" field
      // When reviewPullRequest runs
      const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

      // Then it returns a completed review with 1 finding
      expect(review.status).toBe("success");
      expect(review.findings).toHaveLength(1);
    });

    it("the new optional fields can be added without removing the old ones", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const sink = new MemoryAuditTrailSink();
      const logger = createLogger("test.audit");

      // Given review options with provider, logger, auditTrailSink, and strictAudit true
      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, logger, auditTrailSink: sink, strictAudit: true },
      );

      // Then it returns a completed review with 1 finding
      expect(review.status).toBe("success");
      expect(review.findings).toHaveLength(1);
      // And the injected sink received at least review.started and review.completed
      expect(eventTypes(sink)).toContain("review.started");
      expect(eventTypes(sink)).toContain("review.completed");
    });
  });

  // --- R-02 ------------------------------------------------------------------
  describe("R-02 no sink means unchanged behavior", () => {
    it("a review with no sink returns the expected successful result", async () => {
      const provider = new FindingsProvider([rawFinding(), rawFinding({ title: "Second" })]);

      // Given review options without an auditTrailSink
      // When reviewPullRequest runs
      const review = await reviewPullRequest({ pullRequest, diff, config }, { provider });

      // Then it returns a completed review with 2 findings, identical to before the feature
      expect(review.status).toBe("success");
      expect(review.findings).toHaveLength(2);
      expect(provider.calls).toBe(1);
    });
  });

  // --- R-03 ------------------------------------------------------------------
  describe("R-03 the orchestrator never emits trail.started", () => {
    it("a completed review emits no trail.started event", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

      // Then the recorded events contain no trail.started and start with review.started
      expect(eventTypes(sink)).not.toContain("trail.started");
      expect(sink.getEvents().at(0)?.event).toBe("review.started");
    });

    it("a failed review emits no trail.started event", async () => {
      const provider = new TransportErrorProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs against a failing provider
      await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

      // Then the recorded events contain no trail.started and end with review.failed
      expect(eventTypes(sink)).not.toContain("trail.started");
      expect(sink.getEvents().at(-1)?.event).toBe("review.failed");
    });
  });

  // --- R-04 / R-05 -----------------------------------------------------------
  describe("R-04/R-05 logical event sequence", () => {
    it("happy path emits started, called, one finding event each, then completed", async () => {
      const provider = new FindingsProvider(
        [rawFinding({ title: "First" }), rawFinding({ title: "Second" })],
        { prompt: 812, completion: 144 },
      );
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then the recorded event types are exactly the nominal sequence
      expect(eventTypes(sink)).toEqual([
        "review.started",
        "llm.called",
        "finding.created",
        "finding.created",
        "review.completed",
      ]);

      // And review.started carries the pull request and provider identity
      const started = findEvent(sink, "review.started");
      expect(started?.["pr_id"]).toBe(4242);
      expect(started?.["commit_sha"]).toBe(COMMIT_SHA);
      expect(started?.["llm_provider"]).toBe("anthropic");
      expect(started?.["llm_model"]).toBe("claude-sonnet-4-6");

      // And llm.called carries a non-empty prompt_hash and non-negative token counts
      const called = findEvent(sink, "llm.called");
      const promptHash = called?.["prompt_hash"];
      expect(typeof promptHash).toBe("string");
      expect(String(promptHash)).not.toHaveLength(0);
      expect(called?.["tokens_in"]).toBe(812);
      expect(called?.["tokens_out"]).toBe(144);
      expect(review.walkthrough_markdown).toContain(
        `Prompt sha256: ${String(promptHash).replace("sha256:", "")}`,
      );
      expect(WalkthroughInputSchema.parse(review).provenance?.prompt_sha256).toBe(
        String(promptHash).replace("sha256:", ""),
      );

      // And each finding.created carries the finding's audit_reference, severity, references
      const findings = sink.getEvents().filter((event) => event.event === "finding.created");
      for (const finding of findings) {
        const record = finding as Record<string, unknown>;
        expect(record["audit_reference"]).toMatch(AUDIT_REFERENCE_PATTERN);
        expect(record["severity"]).toBe("major");
        expect(Array.isArray(record["compliance_references"])).toBe(true);
      }
    });

    it.each([0, 1, 3])(
      "finding.created count equals the number of final findings (%i)",
      async (count) => {
        const provider = new FindingsProvider(
          Array.from({ length: count }, (_unused, index) =>
            rawFinding({ title: `Finding ${index}` }),
          ),
        );
        const sink = new MemoryAuditTrailSink();

        // When reviewPullRequest runs
        await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

        const types = eventTypes(sink);
        expect(types.filter((type) => type === "finding.created")).toHaveLength(count);
        expect(types.filter((type) => type === "review.started")).toHaveLength(1);
        expect(types.filter((type) => type === "llm.called")).toHaveLength(1);
        expect(types.filter((type) => type === "review.completed")).toHaveLength(1);
      },
    );

    it("a malformed-then-corrected response still emits a single llm.called", async () => {
      const provider = new MalformedThenValidProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then the sequence has exactly one llm.called with aggregated tokens
      expect(eventTypes(sink)).toEqual([
        "review.started",
        "llm.called",
        "finding.created",
        "review.completed",
      ]);
      const called = findEvent(sink, "llm.called");
      expect(called?.["tokens_in"]).toBe(900);
      expect(called?.["tokens_out"]).toBe(80);

      expect(provider.systemPrompts).toHaveLength(2);
      const retrySystemPrompt = provider.systemPrompts[1] ?? "";
      expect(retrySystemPrompt).toContain("Correct the previous provider response.");
      const retryPromptSha256 = computePromptSha256(
        retrySystemPrompt,
        provider.userPrompts[1] ?? "",
      );
      expect(called?.["prompt_hash"]).toBe(`sha256:${retryPromptSha256}`);
      expect(review.walkthrough_markdown).toContain(`Prompt sha256: ${retryPromptSha256}`);
    });

    it("finding.created carries cwe only when the finding has one", async () => {
      const provider = new FindingsProvider([
        rawFinding({
          title: "SQL injection",
          severity: "blocker",
          category: "security",
          cwe: "CWE-89",
        }),
        rawFinding({ title: "Unclear variable", severity: "minor" }),
      ]);
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

      const findings = sink
        .getEvents()
        .filter((event) => event.event === "finding.created") as Record<string, unknown>[];
      expect(findings).toHaveLength(2);
      const blocker = findings.find((finding) => finding["severity"] === "blocker");
      const minor = findings.find((finding) => finding["severity"] === "minor");
      // And the blocker finding carries cwe "CWE-89"
      expect(blocker?.["cwe"]).toBe("CWE-89");
      // And the minor finding carries no cwe field
      expect(minor && "cwe" in minor).toBe(false);
    });

    it("no files left after ignore filters ends with review.completed and no LLM call", async () => {
      const provider = new NeverCalledProvider();
      const sink = new MemoryAuditTrailSink();

      // Given the repository config ignores every path in the diff
      const ignoreAllConfig = { ...config, ignores: ["**"] };

      // When reviewPullRequest runs
      await reviewPullRequest(
        { pullRequest, diff, config: ignoreAllConfig },
        { provider, auditTrailSink: sink },
      );

      // Then only review.started and review.completed are recorded and the provider is untouched
      expect(eventTypes(sink)).toEqual(["review.started", "review.completed"]);
      expect(provider.calls).toBe(0);
    });
  });

  // --- R-06 ------------------------------------------------------------------
  describe("R-06 strictAudit is an accepted no-op", () => {
    it("strictAudit true is accepted and changes nothing", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs with strictAudit true
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink, strictAudit: true },
      );

      expect(review.status).toBe("success");
      expect(eventTypes(sink)).toEqual([
        "review.started",
        "llm.called",
        "finding.created",
        "review.completed",
      ]);
    });

    it("the event sequence is identical with strictAudit true and omitted", async () => {
      const sinkOn = new MemoryAuditTrailSink();
      const sinkOff = new MemoryAuditTrailSink();

      await reviewPullRequest(
        { pullRequest, diff, config },
        {
          provider: new FindingsProvider([rawFinding()]),
          auditTrailSink: sinkOn,
          strictAudit: true,
        },
      );
      await reviewPullRequest(
        { pullRequest, diff, config },
        { provider: new FindingsProvider([rawFinding()]), auditTrailSink: sinkOff },
      );

      expect(eventTypes(sinkOn)).toEqual(eventTypes(sinkOff));
    });
  });

  // --- R-08 ------------------------------------------------------------------
  describe("R-08 a failing sink never blocks the review", () => {
    it("an append that always rejects does not break the review", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const logger = createLogger("test.audit");
      const errorSpy = vi.spyOn(logger, "error");

      // Given an audit sink whose append always rejects
      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, logger, auditTrailSink: new AlwaysFailingSink() },
      );

      // Then a completed review with 1 finding is still returned, no error thrown
      expect(review.status).toBe("success");
      expect(review.findings).toHaveLength(1);
      // And the logger recorded at least one error about the append failure
      expect(errorSpy).toHaveBeenCalled();
    });

    it("a sink that rejects only the first event still lets the review proceed", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const logger = createLogger("test.audit");
      const errorSpy = vi.spyOn(logger, "error");
      const sink = new FailFirstEventSink();

      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, logger, auditTrailSink: sink },
      );

      // Then the review still reaches its terminal event and the failure was logged
      expect(review.status).toBe("success");
      expect(errorSpy).toHaveBeenCalled();
      expect(sink.getEvents().at(-1)?.event).toBe("review.completed");
    });
  });

  // --- R-09 ------------------------------------------------------------------
  describe("R-09 review.failed terminal event", () => {
    it.each([
      { files: 51, additions: 10, deletions: 10 },
      { files: 1, additions: 5001, deletions: 0 },
      { files: 51, additions: 5001, deletions: 0 },
    ])("exceeding a review limit ends with review.failed (%o)", async (limits) => {
      const provider = new NeverCalledProvider();
      const sink = new MemoryAuditTrailSink();
      const overLimitPr: PullRequest = {
        ...pullRequest,
        changed_files: limits.files,
        additions: limits.additions,
        deletions: limits.deletions,
      };

      // When reviewPullRequest runs against an over-limit pull request
      await reviewPullRequest(
        { pullRequest: overLimitPr, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then only review.started and review.failed are recorded, error_code limit_exceeded
      expect(eventTypes(sink)).toEqual(["review.started", "review.failed"]);
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("limit_exceeded");
      expect(provider.calls).toBe(0);
    });

    it("a pull request exactly at both limits still completes", async () => {
      const provider = new FindingsProvider([rawFinding()]);
      const sink = new MemoryAuditTrailSink();
      const atLimitPr: PullRequest = {
        ...pullRequest,
        changed_files: 50,
        additions: 2500,
        deletions: 2500,
      };

      // When reviewPullRequest runs at the boundary
      await reviewPullRequest(
        { pullRequest: atLimitPr, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then it completes rather than failing
      expect(sink.getEvents().at(-1)?.event).toBe("review.completed");
      expect(eventTypes(sink)).not.toContain("review.failed");
    });

    it("a non-recoverable provider error ends with review.failed and no llm.called", async () => {
      const provider = new TransportErrorProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

      // Then only review.started and review.failed are recorded, error_code provider_error
      expect(eventTypes(sink)).toEqual(["review.started", "review.failed"]);
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("provider_error");
      expect(eventTypes(sink)).not.toContain("llm.called");
    });

    it("an unparseable response that fails again ends with review.failed parse_error", async () => {
      const provider = new UnparseableProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then llm.called fired (a response came back) and the terminal is parse_error
      expect(eventTypes(sink)).toEqual(["review.started", "llm.called", "review.failed"]);
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("parse_error");
      const promptHash = findEvent(sink, "llm.called")?.["prompt_hash"];
      expect(typeof promptHash).toBe("string");
      expect(review.walkthrough_markdown).toContain(
        `Prompt sha256: ${String(promptHash).replace("sha256:", "")}`,
      );
    });

    it("a malformed first response then a retry transport error still records llm.called", async () => {
      const provider = new MalformedThenTransportErrorProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs (a response WAS received on the first attempt)
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then llm.called is recorded even though the review fails as a provider error
      expect(eventTypes(sink)).toEqual(["review.started", "llm.called", "review.failed"]);
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("provider_error");
      const promptHash = findEvent(sink, "llm.called")?.["prompt_hash"];
      expect(typeof promptHash).toBe("string");
      expect(review.walkthrough_markdown).toContain("provider transport failure on retry");
      expect(review.walkthrough_markdown).toContain(
        `Prompt sha256: ${String(promptHash).replace("sha256:", "")}`,
      );
      expect(review.walkthrough_markdown).not.toContain("## ✅ Approve");
    });

    it("a token-bearing retryable schema error still records llm.called", async () => {
      const provider = new TokenBearingSchemaErrorProvider();
      const sink = new MemoryAuditTrailSink();

      // When the provider throws a retryable schema error carrying token usage on both attempts
      const review = await reviewPullRequest(
        { pullRequest, diff, config },
        { provider, auditTrailSink: sink },
      );

      // Then llm.called is recorded (the model responded and was charged) before parse_error
      expect(eventTypes(sink)).toEqual(["review.started", "llm.called", "review.failed"]);
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("parse_error");
      const promptHash = findEvent(sink, "llm.called")?.["prompt_hash"];
      expect(typeof promptHash).toBe("string");
      expect(review.walkthrough_markdown).toContain(
        `Prompt sha256: ${String(promptHash).replace("sha256:", "")}`,
      );
    });

    it("a propagated exception records review.failed then re-throws", async () => {
      const provider = new PropagatingProvider();
      const sink = new MemoryAuditTrailSink();

      // When reviewPullRequest runs, the original exception is re-thrown
      await expect(
        reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink }),
      ).rejects.toBeInstanceOf(z.ZodError);

      // And the last recorded event is review.failed with error_code unexpected_error
      expect(sink.getEvents().at(-1)?.event).toBe("review.failed");
      expect(findEvent(sink, "review.failed")?.["error_code"]).toBe("unexpected_error");
    });

    it("the review.failed payload leaks no diff content or PII", async () => {
      const secret = "SECRET-LEAK-CANARY-4242";
      const provider = new TransportErrorProvider();
      const sink = new MemoryAuditTrailSink();
      const secretDiff = buildDiff(`+const apiKey = "${secret}";`);

      // When reviewPullRequest runs over a diff containing a secret
      await reviewPullRequest(
        { pullRequest, diff: secretDiff, config },
        { provider, auditTrailSink: sink },
      );

      // Then neither error_code nor error_message leak the secret or raw diff lines
      const failed = findEvent(sink, "review.failed");
      expect(failed?.["error_code"]).toBe("provider_error");
      expect(JSON.stringify(failed)).not.toContain(secret);
    });

    it("review.failed does not persist a provider error message that echoes PR content", async () => {
      const secret = "SECRET-LEAK-CANARY-4242";
      const provider = new SecretEchoingProvider(secret);
      const sink = new MemoryAuditTrailSink();

      // When the provider's own error message quotes the request content
      await reviewPullRequest({ pullRequest, diff, config }, { provider, auditTrailSink: sink });

      // Then the signed trail records only a generic message, never the echoed secret
      const failed = findEvent(sink, "review.failed");
      expect(failed?.["error_code"]).toBe("provider_error");
      expect(JSON.stringify(failed)).not.toContain(secret);
    });
  });
});

// Build a one-file unified diff for "src/payments/charge.ts" with a custom added line.
function buildDiff(addedLine: string): Diff {
  const unified = `diff --git a/src/payments/charge.ts b/src/payments/charge.ts
index 1111111..2222222 100644
--- a/src/payments/charge.ts
+++ b/src/payments/charge.ts
@@ -10,2 +10,3 @@ export function charge()
 export function charge() {
${addedLine}
 }
`;

  return {
    unified_diff: unified,
    files: [
      {
        path: "src/payments/charge.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        sha: "cccccccccccccccccccccccccccccccccccccccc",
        patch: `@@ -10,2 +10,3 @@ export function charge()\n export function charge() {\n${addedLine}\n }`,
        hunks: [
          {
            old_start: 10,
            old_lines: 2,
            new_start: 10,
            new_lines: 3,
            header: "@@ -10,2 +10,3 @@ export function charge()",
            lines: [" export function charge() {", addedLine, " }"],
          },
        ],
      },
    ],
  };
}
