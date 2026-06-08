// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { Writable } from "node:stream";
import { pino } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Acceptance test for the telemetry redaction guard (GitHub issue #2437,
// telemetry-redaction-guard.feature, R-01..R-10). The guard is a pure function in
// @sovri/observability that allowlists span-attribute / metric-tag keys and censors secret-shaped
// values to "[Redacted]" before anything reaches a span or meter; it also asserts that the existing
// Pino REDACT_PATHS log path stays redacted. The OTel API is stubbed at the module boundary so the
// wiring scenarios assert on fakes — no SDK is started, no OTLP/Prometheus exporter is reached, no
// port is opened. Secret VALUES are synthetic; "@sovri/core" is never mocked. R-10 (SPDX header,
// no any/as, .js imports, CHANGELOG) is an out-of-band gate enforced by tsc + oxlint + oxfmt.

// Detection is shape-anchored substring (feature D-03): sk- + >=16 key chars, ghp_/ghs_/github_pat_
// with a trailing token tail, a PEM private-key header, or a webhook-shaped JSON object. A benign
// value that merely contains the literal "sk-" (e.g. "task-131") is kept.

const CENSOR = "[Redacted]";

// The 16 permitted keys: the 4 ARCHI 10.2.2 span attributes + 9 ARCHI 10.2.3 metric tags + the 3
// non-sensitive operational attributes the review-engine spans already carry (changed_files /
// reviewable_files on fetch_diff, provider.model on llm_call).
const EXPECTED_ALLOWED_KEYS = [
  "pr.number",
  "pr.repo",
  "llm.provider",
  "findings.count",
  "changed_files",
  "reviewable_files",
  "provider.model",
  "status",
  "llm_provider",
  "severity",
  "category",
  "source",
  "provider",
  "model",
  "direction",
  "error_type",
] as const;

// Controllable OTel fakes shared with the vi.mock factory — same shape as tracing.test.ts. The fake
// tracer's startActiveSpan invokes the callback with the fake span and returns its result; the fake
// meter hands back one counter and one histogram whose add/record are spies.
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
  return { span, counter, histogram, startActiveSpan, getTracer, getMeter };
});

vi.mock("@opentelemetry/api", () => ({
  trace: { getTracer: mocks.getTracer },
  metrics: { getMeter: mocks.getMeter },
  context: {},
  propagation: {},
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}));

const loadGuard = async (): Promise<typeof import("./redaction.js")> => import("./redaction.js");
const loadTracing = async (): Promise<typeof import("./tracing.js")> => import("./tracing.js");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

// ── R-01 — a key outside the allowlist is dropped ───────────────────────────────────────────────
describe("sanitizeTelemetryAttributes — allowlist gates keys (R-01)", () => {
  // Given the input record of allowlisted scalar attributes
  // When sanitizeTelemetryAttributes is called on it
  // Then the output equals the input and every key is a member of ALLOWED_TELEMETRY_KEYS
  it("passes allowlisted scalar attributes through unchanged", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({
      "pr.number": 42,
      "pr.repo": "mpiton/sovri",
      "llm.provider": "anthropic",
      "findings.count": 3,
    });

    expect(out).toEqual({
      "pr.number": 42,
      "pr.repo": "mpiton/sovri",
      "llm.provider": "anthropic",
      "findings.count": 3,
    });
  });

  // Given a record carrying a key not in the allowlist alongside an allowed "status"
  // When sanitizeTelemetryAttributes is called on it
  // Then the off-allowlist key is absent and "status" still carries "succeeded"
  it.each([
    ["delivery_id", "8f3b2c1a-1234-4abc-9def-0123456789ab"],
    ["github_token", "redacted-by-key-not-by-value"],
    ["diff_body", "- const x = 1"],
    ["user.email", "octocat@example.com"],
    ["Authorization", "Bearer abc"],
  ])("drops the off-allowlist key %s", async (key, value) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ [key]: value, status: "succeeded" });

    expect(out).not.toHaveProperty(key);
    expect(out).toMatchObject({ status: "succeeded" });
  });

  // Given an input with no allowlisted key (empty, or every key off-allowlist)
  // When sanitizeTelemetryAttributes is called on it
  // Then the output is the empty record {}
  it.each([
    ["empty input", {}],
    ["every key off-allowlist", { delivery_id: "8f3b2c1a", x: 1 }],
  ])("yields {} for %s", async (_label, input) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    expect(sanitizeTelemetryAttributes(input)).toEqual({});
  });

  // Given an off-allowlist key holding a secret-shaped value
  // When sanitizeTelemetryAttributes is called on it
  // Then the key is dropped and no "[Redacted]" value is emitted (allowlist check precedes censoring)
  it("drops an off-allowlist key by key, never emitting it as [Redacted]", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({
      github_token: "ghp_FAKE0123456789abcdef",
    });

    expect(out).not.toHaveProperty("github_token");
    expect(Object.values(out)).not.toContain(CENSOR);
  });
});

// ── R-02 — token/key/PEM value is censored ──────────────────────────────────────────────────────
describe("sanitizeTelemetryAttributes — secret-shaped values are censored (R-02)", () => {
  // Given an allowed key whose value matches a secret pattern
  // When sanitizeTelemetryAttributes is called on it
  // Then the entry is exactly "[Redacted]" and the cleartext appears nowhere in the output
  it.each([
    ["llm.provider", "ghp_FAKE0123456789abcdef"],
    ["llm.provider", "gho_FAKE0123456789abcdef"],
    ["llm.provider", "ghu_FAKE0123456789abcdef"],
    ["llm.provider", "ghr_FAKE0123456789abcdef"],
    ["llm.provider", "ghs_FAKE0123456789abcdef0123"],
    // Stateless GitHub App installation token: ghs_ + numeric app id + JWT (with "." and "-").
    ["provider", "ghs_123456_FAKEjwtHeader.FAKEjwtPayload-FAKEsig"],
    ["source", "github_pat_11ABCDE0a1b2c3d4e5f60123456789abcdef"],
    ["provider", "sk-FAKE0123456789abcdef"],
    ["model", "-----BEGIN RSA PRIVATE KEY-----"],
  ])("censors %s = %s", async (key, secret) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ [key]: secret });

    expect(out[key]).toBe(CENSOR);
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  // Given an allowed key whose value merely contains a token-like substring but no real token shape
  // When sanitizeTelemetryAttributes is called on it
  // Then the value is kept verbatim, not replaced by "[Redacted]"
  it.each([
    ["category", "task-131"],
    ["category", "risk-major"],
    ["model", "gpt-4o"],
    ["source", "github"],
  ])("keeps the benign value %s = %s", async (key, value) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ [key]: value });

    expect(out[key]).toBe(value);
  });
});

// ── R-03 — webhook-shaped JSON value is treated as a raw payload ─────────────────────────────────
describe("sanitizeTelemetryAttributes — webhook-shaped JSON is censored (R-03)", () => {
  // Given an allowed key whose string value parses as a webhook-shaped JSON object
  // When sanitizeTelemetryAttributes is called on it
  // Then the entry is "[Redacted]" and no marker key or nested payload value survives
  it.each([
    [
      '{"installation":{"id":42},"pull_request":{"number":7},"sender":{"login":"octocat"}}',
      "all three",
    ],
    ['{"pull_request":{"number":7}}', "single marker"],
    ['{"sender":{"login":"octocat"},"action":"opened"}', "one marker plus noise"],
  ])("censors webhook JSON (%s)", async (json) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ source: json });

    expect(out.source).toBe(CENSOR);
    expect(JSON.stringify(out)).not.toContain("octocat");
    expect(JSON.stringify(out)).not.toContain("pull_request");
  });

  // Given a scalar string that parses to a non-webhook JSON object
  // When sanitizeTelemetryAttributes is called on it
  // Then it is kept, because it exposes no webhook marker key
  it("keeps a non-webhook JSON string", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ status: '{"count":3}' });

    expect(out.status).toBe('{"count":3}');
  });
});

// ── R-04 — only scalars pass ─────────────────────────────────────────────────────────────────────
describe("sanitizeTelemetryAttributes — only scalars pass (R-04)", () => {
  // Given an allowed key holding a non-scalar value, alongside an allowed "status"
  // When sanitizeTelemetryAttributes is called on it
  // Then the non-scalar key is dropped and "status" still carries "succeeded"
  it.each([
    ["object", { nested: 1 }],
    ["array", [1, 2, 3]],
    ["function", (): number => 1],
    ["null", null],
  ])("drops the %s value on findings.count", async (_kind, nonscalar) => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({ "findings.count": nonscalar, status: "succeeded" });

    expect(out).not.toHaveProperty("findings.count");
    expect(out).toMatchObject({ status: "succeeded" });
  });

  // Given a record of string, number, and boolean scalars on allowed keys
  // When sanitizeTelemetryAttributes is called on it
  // Then all three scalar kinds are preserved
  it("preserves string, number, and boolean scalars", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const out = sanitizeTelemetryAttributes({
      "pr.repo": "mpiton/sovri",
      "pr.number": 42,
      "llm.provider": true,
    });

    expect(out).toEqual({ "pr.repo": "mpiton/sovri", "pr.number": 42, "llm.provider": true });
  });
});

// ── R-05 — pure, total, deterministic ───────────────────────────────────────────────────────────
describe("sanitizeTelemetryAttributes — pure, total, deterministic (R-05)", () => {
  // Given any input including malformed entries (undefined values, NaN, non-scalars)
  // When sanitizeTelemetryAttributes is called twice on the same input
  // Then both calls return deeply-equal output and neither throws
  it("is deterministic and never throws on malformed input", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();

    const malformed: Record<string, unknown> = {
      "pr.number": Number.NaN,
      status: undefined,
      severity: "blocker",
      category: { nope: true },
    };

    const first = sanitizeTelemetryAttributes(malformed);
    const second = sanitizeTelemetryAttributes(malformed);

    expect(first).toEqual(second);
    expect(() => sanitizeTelemetryAttributes(malformed)).not.toThrow();
  });
});

// ── R-06 — withSpan / recordMetric route through the guard ───────────────────────────────────────
describe("withSpan / recordMetric route through the guard (R-06)", () => {
  // Given withSpan is called with an off-allowlist key and a secret-shaped allowed value
  // When the span records its attributes
  // Then "llm.provider" is "[Redacted]", "delivery_id" is absent, and no raw token reaches the span
  it("sanitizes the caller attributes before they reach the span", async () => {
    const { withSpan } = await loadTracing();

    await withSpan("review.run", async () => "ok", {
      "llm.provider": "ghp_FAKE0123456789abcdef",
      delivery_id: "8f3b2c1a",
    });

    expect(mocks.span.setAttributes).toHaveBeenCalledTimes(1);
    const passed = mocks.span.setAttributes.mock.calls[0]?.[0];
    expect(passed).toEqual({ "llm.provider": CENSOR });
    expect(JSON.stringify(passed)).not.toContain("ghp_FAKE0123456789abcdef");
  });

  // Given a withSpan body setting one allowed and one off-allowlist attribute via the forwarded span
  // When the span records those attributes
  // Then "findings.count" is set to 3 and the off-allowlist "token" never reaches the span
  it("guards the SpanLike handle forwarded to fn so it cannot bypass the choke point", async () => {
    const { withSpan } = await loadTracing();

    await withSpan("review.run", async (span) => {
      span.setAttribute("findings.count", 3);
      span.setAttribute("token", "ghp_FAKE0123456789abcdef");
      return "ok";
    });

    expect(mocks.span.setAttribute).toHaveBeenCalledWith("findings.count", 3);
    expect(mocks.span.setAttribute).not.toHaveBeenCalledWith("token", expect.anything());
  });

  // Given recordMetric is called with off-allowlist and secret-shaped tags
  // When the counter increment is recorded
  // Then the emitted tag set is exactly { status: "succeeded" }
  it("sanitizes the metric tag set before it reaches the meter", async () => {
    const { recordMetric } = await loadTracing();

    recordMetric({ name: "sovri.reviews.total", kind: "counter" }, 1, {
      status: "succeeded",
      secret: "sk-FAKE0123456789abcdef",
      delivery_id: "8f3b2c1a",
    });

    expect(mocks.counter.add).toHaveBeenCalledTimes(1);
    expect(mocks.counter.add).toHaveBeenCalledWith(1, { status: "succeeded" });
  });
});

// ── R-07 — the instrumented log path stays redacted ─────────────────────────────────────────────
// captureWritable mirrors logger.test.ts: buffer partial lines across chunk boundaries.
function captureWritable(): { writable: Writable; lines: string[] } {
  const lines: string[] = [];
  let pending = "";
  const writable = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);
      pending += text;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        if (line.length > 0) lines.push(line);
      }
      cb();
    },
  });
  return { writable, lines };
}

describe("the instrumented log path stays redacted (R-07)", () => {
  // Given a createLogger child writing to a captured stream
  // When it logs an object carrying token, apiKey, authorization, pem, and webhook_secret
  // Then each field shows "[Redacted]" and none of the cleartext secrets appears in the output
  it("asserts the existing REDACT_PATHS coverage without weakening it", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const { transport: _transport, ...opts } = buildLoggerOptions({ NODE_ENV: "production" });
    void _transport;
    const capture = captureWritable();
    const logger = pino(opts, capture.writable).child({ component: "redaction-guard.test" });

    const secrets = {
      token: "ghp_FAKE0123456789abcdef",
      apiKey: "sk-FAKE0123456789abcdef",
      authorization: "Bearer leak",
      pem: "-----BEGIN RSA PRIVATE KEY-----",
      webhook_secret: "whsec_leak",
    };
    logger.info(secrets, "instrumented");

    expect(capture.lines).toHaveLength(1);
    const record = JSON.parse(capture.lines[0] ?? "{}");
    for (const field of Object.keys(secrets)) {
      expect(record[field]).toBe(CENSOR);
    }
    for (const cleartext of Object.values(secrets)) {
      expect(capture.lines[0]).not.toContain(cleartext);
    }
  });

  // Given the delivery_id correlation field
  // Then it is absent from ALLOWED_TELEMETRY_KEYS, so the guard drops it from any span or metric
  it("keeps delivery_id out of the telemetry allowlist (correlation stays in logs)", async () => {
    const { ALLOWED_TELEMETRY_KEYS } = await loadGuard();

    expect([...ALLOWED_TELEMETRY_KEYS]).not.toContain("delivery_id");
  });
});

// ── R-08 — the allowlist is the single source of truth ──────────────────────────────────────────
describe("the allowlist is the single source of truth (R-08)", () => {
  // Given ALLOWED_TELEMETRY_KEYS exported from the guard
  // Then it contains exactly the four span attributes and nine metric tags from ARCHI 10.2
  it("enumerates exactly the 16 permitted keys", async () => {
    const { ALLOWED_TELEMETRY_KEYS } = await loadGuard();

    expect([...ALLOWED_TELEMETRY_KEYS].toSorted()).toEqual([...EXPECTED_ALLOWED_KEYS].toSorted());
  });

  // Given the package barrel index.ts
  // Then it re-exports the guard alongside the task-126 withSpan / recordMetric surface
  it("re-exports the guard from the barrel", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const barrel = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(barrel).toMatch(
      /export\s*\{[^}]*\bsanitizeTelemetryAttributes\b[^}]*\}\s*from\s*["']\.\/redaction\.js["']/u,
    );
    expect(barrel).toMatch(
      /export\s*\{[^}]*\bALLOWED_TELEMETRY_KEYS\b[^}]*\}\s*from\s*["']\.\/redaction\.js["']/u,
    );
    expect(barrel).toMatch(
      /export\s+type\s*\{[^}]*\bAllowedTelemetryKey\b[^}]*\}\s*from\s*["']\.\/redaction\.js["']/u,
    );
  });
});

// ── R-09 — property/fuzz: no secret survives, no off-allowlist key survives ──────────────────────
// Seeded generator (fast-check is not a dev dependency). mulberry32 is deterministic — a fixed seed
// makes any failure reproducible, satisfying the "fixed seed" rule with no Math.random / clock.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randTail(rng: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += ALNUM.charAt(Math.floor(rng() * ALNUM.length));
  }
  return out;
}

function secretSample(rng: () => number, kind: number): string {
  switch (kind % 5) {
    case 0:
      return `ghp_${randTail(rng, 24)}`;
    case 1:
      return `ghs_${randTail(rng, 36)}`;
    case 2:
      return `github_pat_${randTail(rng, 40)}`;
    case 3:
      return `sk-${randTail(rng, 24)}`;
    default:
      return `-----BEGIN RSA PRIVATE KEY-----\n${randTail(rng, 40)}\n-----END RSA PRIVATE KEY-----`;
  }
}

describe("property/fuzz — no secret or off-allowlist key survives (R-09)", () => {
  // Given a seeded stream of token-like, sk-, and PEM values placed on an allowed key
  // When sanitizeTelemetryAttributes is called on each
  // Then every secret value is "[Redacted]" and never appears in the output
  it("censors every secret-shaped value on an allowed key", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();
    const rng = mulberry32(0x5e_c0_de);

    for (let i = 0; i < 256; i += 1) {
      const secret = secretSample(rng, i);
      const out = sanitizeTelemetryAttributes({ provider: secret });

      expect(out.provider, `secret #${i} must be censored: ${secret}`).toBe(CENSOR);
      expect(JSON.stringify(out)).not.toContain(secret.slice(0, 16));
    }
  });

  // Given a seeded stream of webhook-shaped JSON payloads on an allowed key
  // When sanitizeTelemetryAttributes is called on each
  // Then every payload is "[Redacted]"
  it("censors every webhook-shaped JSON payload", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();
    const rng = mulberry32(0xb0_0b);

    for (let i = 0; i < 128; i += 1) {
      const payload = JSON.stringify({
        installation: { id: Math.floor(rng() * 1000) },
        pull_request: { number: Math.floor(rng() * 1000) },
        sender: { login: randTail(rng, 8) },
      });
      const out = sanitizeTelemetryAttributes({ source: payload });

      expect(out.source, `payload #${i} must be censored`).toBe(CENSOR);
    }
  });

  // Given a seeded stream of off-allowlist keys carrying arbitrary values
  // When sanitizeTelemetryAttributes is called on each
  // Then none of the off-allowlist keys survives into the output
  it("drops every off-allowlist key", async () => {
    const { sanitizeTelemetryAttributes } = await loadGuard();
    const rng = mulberry32(0xf0_0d);

    for (let i = 0; i < 128; i += 1) {
      const key = `evil_${randTail(rng, 6)}`;
      const out = sanitizeTelemetryAttributes({ [key]: randTail(rng, 10), status: "succeeded" });

      expect(out, `off-allowlist key #${i} must be absent: ${key}`).not.toHaveProperty(key);
      expect(out).toMatchObject({ status: "succeeded" });
    }
  });
});
