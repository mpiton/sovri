// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { SpanStatusCode } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstrumentDescriptor } from "./tracing.js";

// Acceptance test for the generic withSpan/recordMetric facade (GitHub issue #2406, feature
// tracing-metrics-helpers.feature). The OTel API is stubbed at the module boundary — no scenario
// starts an SDK, opens an OTLP connection, or serves /metrics; span/instrument calls are asserted
// on fakes. Rules R-01..R-09 (R-10 is an out-of-band gate enforced by tsc + oxlint + oxfmt).

// Controllable fakes shared with the vi.mock factory. The fake tracer's startActiveSpan invokes
// the callback with the fake span and returns its result (mirroring the real contract), so withSpan
// stays a transparent pass-through. The fake meter hands back one counter and one histogram whose
// add/record are spies; createCounter/createHistogram are construction spies for the reuse assertion.
const mocks = vi.hoisted(() => {
  const span = {
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
  const counter = { add: vi.fn() };
  const histogram = { record: vi.fn() };
  const createCounter = vi.fn(() => counter);
  const createHistogram = vi.fn(() => histogram);
  const startActiveSpan = vi.fn(<T>(_name: string, fn: (s: typeof span) => T): T => fn(span));
  const getTracer = vi.fn(() => ({ startActiveSpan }));
  const getMeter = vi.fn(() => ({ createCounter, createHistogram }));
  return {
    span,
    counter,
    histogram,
    createCounter,
    createHistogram,
    startActiveSpan,
    getTracer,
    getMeter,
  };
});

vi.mock("@opentelemetry/api", () => ({
  trace: { getTracer: mocks.getTracer },
  metrics: { getMeter: mocks.getMeter },
  // context/propagation are unused by tracing.ts but kept so a transitive import stays happy.
  context: {},
  propagation: {},
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}));

const loadTracing = async (): Promise<typeof import("./tracing.js")> => import("./tracing.js");

// The compile-time type forbids an unmodelled kind / empty name; the runtime Zod guard (R-06)
// defends the untyped boundary (config / JSON) the type cannot reach, so the R-06 test drives that
// guard with an explicit, justified assertion to a loose shape.
const asDescriptor = (value: { name: string; kind: string }): InstrumentDescriptor =>
  value as InstrumentDescriptor;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("withSpan — transparent pass-through of fn's resolved value (R-01)", () => {
  // Given a span is obtained from the tracer named "sovri"
  // When withSpan("review.run", fn) is awaited where fn resolves to <resolved>
  // Then withSpan resolves to exactly <resolved>, neither wrapped nor altered.
  it.each([
    ["the object { findings: 3 }", { findings: 3 }],
    ["the number 0", 0],
    ["undefined", undefined],
  ])("returns %s untouched", async (_label, resolved) => {
    const { withSpan } = await loadTracing();

    const result = await withSpan("review.run", async () => resolved);

    expect(result).toBe(resolved);
    expect(mocks.getTracer).toHaveBeenCalledWith("sovri");
  });

  // Given a span is obtained from the tracer named "sovri"
  // When withSpan("review.run", fn, { "repo": "acme/web", "pr.number": 42 }) is awaited
  // Then the span carries those attributes and withSpan resolves to fn's value.
  it("sets the caller's attributes on the span", async () => {
    const { withSpan } = await loadTracing();

    const result = await withSpan("review.run", async () => "done", {
      repo: "acme/web",
      "pr.number": 42,
    });

    expect(mocks.span.setAttributes).toHaveBeenCalledWith({ repo: "acme/web", "pr.number": 42 });
    expect(result).toBe("done");
  });

  // Given fn needs an attribute computed inside the operation
  // When withSpan("review.run", (span) => span.setAttribute("findings.count", 3)) is awaited
  // Then the forwarded span receives that attribute and withSpan resolves to fn's value.
  it("forwards the active span so fn can set an attribute computed during the operation", async () => {
    const { withSpan } = await loadTracing();

    const result = await withSpan("review.run", async (span) => {
      span.setAttribute("findings.count", 3);
      return "done";
    });

    expect(mocks.span.setAttribute).toHaveBeenCalledWith("findings.count", 3);
    expect(result).toBe("done");
  });
});

describe("withSpan — records the exception and rethrows the original on reject (R-02)", () => {
  // Given a span is obtained from the tracer named "sovri"
  // And fn rejects with the error Error("LLM timeout")
  // When withSpan("review.run", fn) is awaited
  // Then the span records the exception, the status is ERROR with that message, and withSpan
  //   rejects with the SAME Error instance — neither wrapped nor swallowed.
  it("records the exception, sets ERROR status, and rethrows the same instance", async () => {
    const { withSpan } = await loadTracing();
    const boom = new Error("LLM timeout");

    await expect(
      withSpan("review.run", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(mocks.span.recordException).toHaveBeenCalledWith(boom);
    expect(mocks.span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "LLM timeout",
    });
  });
});

describe("withSpan — ends the span exactly once on both paths (R-03)", () => {
  // Given a span is obtained from the tracer named "sovri"
  // When withSpan("review.run", fn) settles where fn <outcome>
  // Then span.end() is called exactly once.
  it("ends the span once when fn resolves", async () => {
    const { withSpan } = await loadTracing();

    await withSpan("review.run", async () => ({ findings: 3 }));

    expect(mocks.span.end).toHaveBeenCalledTimes(1);
  });

  it("ends the span once when fn rejects", async () => {
    const { withSpan } = await loadTracing();

    await expect(
      withSpan("review.run", async () => {
        throw new Error("LLM timeout");
      }),
    ).rejects.toThrow("LLM timeout");

    expect(mocks.span.end).toHaveBeenCalledTimes(1);
  });
});

describe("the helpers are no-op-safe when telemetry was never initialized (R-04)", () => {
  // Given no telemetry SDK has been initialized
  // And the OpenTelemetry API returns its no-op tracer and no-op meter
  // When withSpan(...) is awaited and recordMetric(...) is called
  // Then withSpan resolves to fn's value without throwing and recordMetric returns without throwing.
  it("runs fn and records nothing through the real OTel no-op tracer/meter", async () => {
    const actual = await vi.importActual<typeof import("@opentelemetry/api")>("@opentelemetry/api");
    mocks.getTracer.mockReturnValueOnce(actual.trace.getTracer("sovri"));
    mocks.getMeter.mockReturnValueOnce(actual.metrics.getMeter("sovri"));
    const { withSpan, recordMetric } = await loadTracing();

    const result = await withSpan("review.run", async () => ({ findings: 3 }));
    expect(result).toEqual({ findings: 3 });

    expect(() => recordMetric({ name: "demo.noop.counter", kind: "counter" }, 1)).not.toThrow();
  });
});

describe("recordMetric — lazy create then reuse by name (R-05)", () => {
  // Given the meter named "sovri" and an empty instrument cache for this name
  // When recordMetric({ name: "demo.reuse.counter", kind: "counter" }, 1) is called
  // Then the meter creates exactly one counter named "demo.reuse.counter"
  // When recordMetric(... same name ...) is called again
  // Then no further instrument is created and the same counter receives the second add.
  it("creates the instrument once and reuses it on the next call", async () => {
    const { recordMetric } = await loadTracing();

    recordMetric({ name: "demo.reuse.counter", kind: "counter" }, 1);
    expect(mocks.createCounter).toHaveBeenCalledTimes(1);
    expect(mocks.createCounter).toHaveBeenCalledWith("demo.reuse.counter", expect.anything());

    recordMetric({ name: "demo.reuse.counter", kind: "counter" }, 1);
    expect(mocks.createCounter).toHaveBeenCalledTimes(1);
    expect(mocks.counter.add).toHaveBeenCalledTimes(2);
  });
});

describe("recordMetric — rejects a descriptor violating the instrument model (R-06)", () => {
  // Given the meter named "sovri"
  // When recordMetric is called with the descriptor <descriptor>
  // Then recordMetric throws a typed validation error and no instrument is created on the meter.
  it.each([
    ["an unmodelled kind", { name: "demo.x", kind: "gauge" }],
    ["an empty name", { name: "", kind: "counter" }],
  ])("rejects %s", async (_label, descriptor) => {
    const { recordMetric } = await loadTracing();

    let caught: unknown;
    try {
      recordMetric(asDescriptor(descriptor), 1);
    } catch (error) {
      caught = error;
    }

    // "a typed validation error caused by the schema rejection": a typed Error whose `cause` is
    // the underlying Zod rejection (itself an Error). Asserted via the cause contract so the RED
    // test stays faithful without importing the not-yet-existing error class.
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.cause : undefined).toBeInstanceOf(Error);

    expect(mocks.createCounter).not.toHaveBeenCalled();
    expect(mocks.createHistogram).not.toHaveBeenCalled();
  });
});

describe("recordMetric — routes the value by instrument kind (R-07)", () => {
  // Given the meter named "sovri"
  // When recordMetric({ name, kind }, value, { "provider": "anthropic" }) is called
  // Then the instrument for that kind receives add/record with the value and the string-keyed tags.
  it("routes a counter value to add(value, tags)", async () => {
    const { recordMetric } = await loadTracing();

    recordMetric({ name: "demo.counter", kind: "counter" }, 1, { provider: "anthropic" });

    expect(mocks.getMeter).toHaveBeenCalledWith("sovri");
    expect(mocks.counter.add).toHaveBeenCalledWith(1, { provider: "anthropic" });
  });

  it("routes a histogram value to record(value, tags)", async () => {
    const { recordMetric } = await loadTracing();

    recordMetric({ name: "demo.histogram.ms", kind: "histogram" }, 250, { provider: "anthropic" });

    expect(mocks.histogram.record).toHaveBeenCalledWith(250, { provider: "anthropic" });
  });
});

describe("the helpers emit only caller-supplied attributes and tags (R-08)", () => {
  // Given a GitHub token and an LLM API key are in scope around the call site
  // When withSpan("review.run", fn, { "repo": "acme/web" }) is awaited
  // Then the only attribute on the span is "repo", and no token/key/payload appears among them.
  // When recordMetric(..., { "provider": "anthropic" }) is called
  // Then the only tag is "provider", and no secret appears among the tags.
  it("never serializes a token, key, or payload into a span attribute or metric tag", async () => {
    const githubToken = "ghs_super_secret_github_token";
    const llmKey = "sk-ant-secret-llm-key";
    const { withSpan, recordMetric } = await loadTracing();

    // The secret lives in the fn closure; the helper must never reach into it.
    await withSpan(
      "review.run",
      async () => {
        void githubToken;
        void llmKey;
        return "ok";
      },
      { repo: "acme/web" },
    );

    expect(mocks.span.setAttributes).toHaveBeenCalledWith({ repo: "acme/web" });
    const spanArgs = JSON.stringify(mocks.span.setAttributes.mock.calls);
    for (const secret of [githubToken, llmKey]) {
      expect(spanArgs.includes(secret), `span attributes must not contain ${secret}`).toBe(false);
    }

    recordMetric({ name: "demo.counter", kind: "counter" }, 1, { provider: "anthropic" });

    expect(mocks.counter.add).toHaveBeenCalledWith(1, { provider: "anthropic" });
    const tagArgs = JSON.stringify(mocks.counter.add.mock.calls);
    for (const secret of [githubToken, llmKey]) {
      expect(tagArgs.includes(secret), `metric tags must not contain ${secret}`).toBe(false);
    }
  });
});

describe("barrel — the package surface is additive (R-09)", () => {
  // Given the package barrel "packages/observability/src/index.ts"
  // Then it keeps createLogger/Logger and the task-125 init/shutdown surface, and adds the facade.
  it("exports withSpan and recordMetric as functions", async () => {
    const tracing = await loadTracing();

    expect(typeof tracing.withSpan).toBe("function");
    expect(typeof tracing.recordMetric).toBe("function");
  });

  it("re-exports the facade from the barrel without changing the existing surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const barrelSource = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf8",
    );

    expect(barrelSource).toMatch(
      /export\s*\{\s*createLogger\s*\}\s*from\s*["']\.\/logger\.js["']/u,
    );
    expect(barrelSource).toMatch(
      /export\s+type\s*\{\s*Logger\s*\}\s*from\s*["']\.\/logger\.js["']/u,
    );
    expect(barrelSource).toMatch(
      /export\s*\{[^}]*\binitTelemetry\b[^}]*\bshutdownTelemetry\b[^}]*\}\s*from\s*["']\.\/telemetry\.js["']/u,
    );
    expect(barrelSource).toMatch(
      /export\s*\{[^}]*\bwithSpan\b[^}]*\brecordMetric\b[^}]*\}\s*from\s*["']\.\/tracing\.js["']/u,
    );
    // And it re-exports the public instrument types (derived via z.infer) from the same module.
    expect(barrelSource).toMatch(
      /export\s+type\s*\{[^}]*\bInstrumentDescriptor\b[^}]*\}\s*from\s*["']\.\/tracing\.js["']/u,
    );
  });
});
