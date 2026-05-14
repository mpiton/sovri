// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createLogger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a child logger with component binding", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger("handler:pull-request");
    expect(log.bindings()).toMatchObject({ component: "handler:pull-request" });
  });

  it("defaults root level to 'info' when LOG_LEVEL is an empty string", async () => {
    vi.stubEnv("LOG_LEVEL", "");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.level).toBe("info");
    expect(log.isLevelEnabled("info")).toBe(true);
    expect(log.isLevelEnabled("debug")).toBe(false);
  });

  it("defaults root level to 'info' when LOG_LEVEL is undefined", async () => {
    vi.stubEnv("LOG_LEVEL", undefined);
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.level).toBe("info");
  });

  it("falls back to 'info' when LOG_LEVEL is invalid", async () => {
    vi.stubEnv("LOG_LEVEL", "garbage");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.level).toBe("info");
  });

  it("honors LOG_LEVEL=debug", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.level).toBe("debug");
    expect(log.isLevelEnabled("debug")).toBe(true);
  });

  it("accepts LOG_LEVEL in mixed case (TRACE)", async () => {
    vi.stubEnv("LOG_LEVEL", "TRACE");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.level).toBe("trace");
  });

  it("attaches default base fields when env vars are empty strings", async () => {
    vi.stubEnv("SERVICE_NAME", "");
    vi.stubEnv("SERVICE_VERSION", "");
    vi.stubEnv("NODE_ENV", "");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.bindings()).toMatchObject({
      component: "x",
      service: "sovri-community-bot",
      version: "0.0.0",
      env: "development",
    });
  });

  it("attaches default base fields when env vars are undefined", async () => {
    vi.stubEnv("SERVICE_NAME", undefined);
    vi.stubEnv("SERVICE_VERSION", undefined);
    vi.stubEnv("NODE_ENV", undefined);
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.bindings()).toMatchObject({
      service: "sovri-community-bot",
      version: "0.0.0",
      env: "development",
    });
  });

  it("overrides base fields from SERVICE_NAME, SERVICE_VERSION, NODE_ENV", async () => {
    vi.stubEnv("SERVICE_NAME", "cloud-api");
    vi.stubEnv("SERVICE_VERSION", "1.2.3");
    vi.stubEnv("NODE_ENV", "production");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("review-engine.orchestrator");
    expect(log.bindings()).toMatchObject({
      component: "review-engine.orchestrator",
      service: "cloud-api",
      version: "1.2.3",
      env: "production",
    });
  });

  it("remains usable when LOG_PRETTY is unset (JSON mode)", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(typeof log.info).toBe("function");
    expect(log.bindings()).toMatchObject({ component: "x" });
  });

  it("remains usable when LOG_PRETTY=true enables pretty transport", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_PRETTY", "true");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.bindings()).toMatchObject({ component: "x" });
    expect(log.level).toBe("info");
  });

  it.each(["1", "yes", "on", "True"])("accepts LOG_PRETTY=%s as truthy", async (value) => {
    vi.stubEnv("LOG_PRETTY", value);
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(log.bindings()).toMatchObject({ component: "x" });
  });

  it("treats LOG_PRETTY=false as JSON mode", async () => {
    vi.stubEnv("LOG_PRETTY", "false");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    expect(typeof log.info).toBe("function");
  });

  it("disables pretty transport when NODE_ENV=production even if LOG_PRETTY=true", async () => {
    vi.stubEnv("LOG_PRETTY", "true");
    vi.stubEnv("NODE_ENV", "production");
    const { createLogger } = await import("./logger.js");
    const log = createLogger("x");
    // The prod guard prevents the pino-pretty worker from spawning.
    // We assert the logger remains functional; the guard branch is exercised
    // (and covered) by reaching this line without a transport-load error.
    expect(log.bindings()).toMatchObject({
      component: "x",
      env: "production",
    });
  });

  it("preserves dot-notation component names as literal strings", async () => {
    const { createLogger } = await import("./logger.js");
    const log = createLogger("review-engine.orchestrator");
    expect(log.bindings()["component"]).toBe("review-engine.orchestrator");
  });
});

describe("buildLoggerOptions", () => {
  it("includes pino-pretty transport when LOG_PRETTY=true and NODE_ENV is not production", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ LOG_PRETTY: "true", NODE_ENV: "development" });
    expect(opts.transport).toMatchObject({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  it("omits transport when NODE_ENV=production even with LOG_PRETTY=true", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ LOG_PRETTY: "true", NODE_ENV: "production" });
    expect(opts.transport).toBeUndefined();
  });

  it("treats NODE_ENV=Production (mixed case) as production", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ LOG_PRETTY: "true", NODE_ENV: "Production" });
    expect(opts.transport).toBeUndefined();
  });

  it("omits transport when LOG_PRETTY is unset", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ NODE_ENV: "development" });
    expect(opts.transport).toBeUndefined();
  });

  it("propagates LOG_LEVEL to options.level after lowercasing", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ LOG_LEVEL: "DEBUG" });
    expect(opts.level).toBe("debug");
  });

  it("falls back to info level for invalid LOG_LEVEL", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({ LOG_LEVEL: "garbage" });
    expect(opts.level).toBe("info");
  });

  it("builds base bindings from SERVICE_NAME, SERVICE_VERSION, NODE_ENV", async () => {
    const { buildLoggerOptions } = await import("./logger.js");
    const opts = buildLoggerOptions({
      SERVICE_NAME: "cloud-api",
      SERVICE_VERSION: "2.0.0",
      NODE_ENV: "staging",
    });
    expect(opts.base).toMatchObject({
      service: "cloud-api",
      version: "2.0.0",
      env: "staging",
    });
  });

  it("emits redact config with [Redacted] censor and REDACT_PATHS", async () => {
    const { buildLoggerOptions, REDACT_PATHS } = await import("./logger.js");
    const opts = buildLoggerOptions({ NODE_ENV: "production" });
    expect(opts.redact).toMatchObject({
      paths: [...REDACT_PATHS],
      censor: "[Redacted]",
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function pathGet(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

// Pino emits one JSON object per call, newline-terminated. Pino's default
// sonic-boom destination writes whole lines atomically, but the stream
// contract allows a chunk boundary mid-record. Buffer the trailing partial
// across writes so a future Pino destination change cannot silently break
// the helper.
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

async function freshLoggerWithCapture(env: NodeJS.ProcessEnv = {}) {
  const { buildLoggerOptions } = await import("./logger.js");
  // Strip transport — pino-pretty cannot coexist with a passed destination
  // stream. Production-mode env keeps transport undefined.
  const { transport: _transport, ...opts } = buildLoggerOptions(env);
  void _transport;
  const capture = captureWritable();
  const logger = pino(opts, capture.writable).child({ component: "test" });
  return { logger, lines: capture.lines };
}

describe("redaction", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC1-AC3 below pin the exact issue #23 acceptance criteria with
  // realistic-shaped secret literals. The parameterised `it.each` below
  // proves the full REDACT_PATHS policy with a generic `"v"` payload — the
  // AC tests intentionally use real-looking secrets so the `not.toMatch`
  // / `not.toContain` assertions guard against regression in the censor
  // semantics, not just the path matching.
  it("redacts top-level `token` field to '[Redacted]' (AC1)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ token: "gho_xxxxxxxxxxxxxxxx" }, "ping");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, "token")).toBe("[Redacted]");
    expect(lines[0]).not.toContain("gho_xxxxxxxxxxxxxxxx");
  });

  it("redacts nested `headers.authorization` to '[Redacted]' (AC2)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ headers: { authorization: "Bearer gho_secret" } }, "ping");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, "headers.authorization")).toBe("[Redacted]");
    expect(lines[0]).not.toContain("Bearer gho_secret");
  });

  it("never leaks a real secret across multiple records (AC3)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ token: "gho_real_token" });
    logger.info({ headers: { authorization: "Bearer real-bearer" } });
    logger.info({ apiKey: "sk-real-key" });
    logger.info({ installation: { token: "ghs_install" } });
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/gho_real_token/);
    expect(joined).not.toMatch(/Bearer real-bearer/);
    expect(joined).not.toMatch(/sk-real-key/);
    expect(joined).not.toMatch(/ghs_install/);
  });

  it.each([
    ["authorization", { authorization: "v" }, "authorization"],
    ["*.authorization", { req: { authorization: "v" } }, "req.authorization"],
    ["headers.authorization", { headers: { authorization: "v" } }, "headers.authorization"],
    ["apiKey", { apiKey: "v" }, "apiKey"],
    ["*.apiKey", { provider: { apiKey: "v" } }, "provider.apiKey"],
    ["api_key", { api_key: "v" }, "api_key"],
    ["token", { token: "v" }, "token"],
    ["*.token", { ctx: { token: "v" } }, "ctx.token"],
    ["installation.token", { installation: { token: "v" } }, "installation.token"],
    ["pem", { pem: "v" }, "pem"],
    ["privateKey", { privateKey: "v" }, "privateKey"],
    ["secret", { secret: "v" }, "secret"],
    ["webhook_secret", { webhook_secret: "v" }, "webhook_secret"],
    ["*.webhook_secret", { cfg: { webhook_secret: "v" } }, "cfg.webhook_secret"],
  ] as const)("redacts path `%s`", async (_label, payload, dottedPath) => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info(payload);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, dottedPath)).toBe("[Redacted]");
    expect(lines[0]).not.toContain('"v"');
  });

  it("leaves non-sensitive fields untouched", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ userId: "u1", action: "open_pr", payload: { sha: "abc123" } });
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, "userId")).toBe("u1");
    expect(pathGet(record, "action")).toBe("open_pr");
    expect(pathGet(record, "payload.sha")).toBe("abc123");
  });

  it("child loggers inherit parent redaction config", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    const child = logger.child({ subcomponent: "octokit-client" });
    child.info({ token: "gho_inherited_secret" });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, "token")).toBe("[Redacted]");
    expect(pathGet(record, "subcomponent")).toBe("octokit-client");
    expect(lines[0]).not.toContain("gho_inherited_secret");
  });

  it("exposes REDACT_PATHS as a readonly tuple", async () => {
    const { REDACT_PATHS } = await import("./logger.js");
    expect(Array.isArray(REDACT_PATHS)).toBe(true);
    expect(REDACT_PATHS).toContain("token");
    expect(REDACT_PATHS).toContain("headers.authorization");
    expect(REDACT_PATHS).toContain("installation.token");
    expect(REDACT_PATHS).toContain("*.webhook_secret");
  });
});

// Boundary tests — pin the explicit limits of the v0.1 redact list so that
// (a) future contributors know which shapes still leak, (b) the README
// "Limitations" section stays in sync with code, and (c) a regression that
// silently broadens the matcher is caught.
describe("redaction boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does NOT redact capitalised `Authorization` (Pino paths are case-sensitive)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ Authorization: "Bearer leaked-because-capitalised" });
    const record = JSON.parse(lines[0] ?? "");
    expect(pathGet(record, "Authorization")).toBe("Bearer leaked-because-capitalised");
  });

  it("does NOT redact a depth-3 `token` (single-level `*.X` wildcard)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ a: { b: { token: "leaked-because-too-deep" } } });
    expect(pathGet(JSON.parse(lines[0] ?? ""), "a.b.token")).toBe("leaked-because-too-deep");
  });

  it("does NOT redact unknown key names that look secret-ish (`clientSecret`)", async () => {
    const { logger, lines } = await freshLoggerWithCapture({ NODE_ENV: "production" });
    logger.info({ clientSecret: "leaked-because-not-in-list" });
    expect(pathGet(JSON.parse(lines[0] ?? ""), "clientSecret")).toBe("leaked-because-not-in-list");
  });
});

// Smoke test the exported `createLogger` path — the redaction policy must
// survive the production module-level `rootLogger` plumbing, not just the
// helper's parallel `pino(opts, dest)` reconstruction.
describe("createLogger end-to-end", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redacts `token` through the exported `createLogger` (not just the helper)", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    vi.stubEnv("NODE_ENV", "production");

    const { createLogger } = await import("./logger.js");
    const log = createLogger("smoke");
    log.info({ token: "gho_smoke_test_secret" }, "redacted?");

    const captured = writes.join("");
    expect(captured).not.toContain("gho_smoke_test_secret");
    expect(captured).toContain("[Redacted]");
  });
});
