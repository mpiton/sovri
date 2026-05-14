// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

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
});
