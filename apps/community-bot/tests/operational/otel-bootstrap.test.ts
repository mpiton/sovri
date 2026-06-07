// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";

import { createLogger } from "@sovri/observability";
import { createNodeMiddleware, Probot } from "probot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { readJsonObject, readRepoFile } from "../scaffold/helpers.js";

// RED acceptance for specs/task-129-bot-otel-bootstrap (R-01..R-09). One feature file = one scenario
// sub-PR. Telemetry from "@sovri/observability" is captured (initTelemetry / shutdownTelemetry spied),
// so no real NodeSDK starts and no OTLP network call happens; createLogger stays real. The graceful
// shutdown is exercised through an injectable seam so no real process signal can kill the test worker.

const telemetry = vi.hoisted(() => ({
  initTelemetry: vi.fn<() => void>(),
  shutdownTelemetry: vi.fn<() => Promise<void>>(async () => undefined),
}));

vi.mock("@sovri/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sovri/observability")>();
  return {
    ...actual,
    initTelemetry: telemetry.initTelemetry,
    shutdownTelemetry: telemetry.shutdownTelemetry,
  };
});

const INSTRUMENTATION_MODULE = "../../src/instrumentation.js";
const SHUTDOWN_MODULE = "../../src/shutdown.js";
const SERVER_SOURCE = "apps/community-bot/src/server.ts";
const INSTRUMENTATION_SOURCE = "apps/community-bot/src/instrumentation.ts";
const SHUTDOWN_SOURCE = "apps/community-bot/src/shutdown.ts";
const ROOT_DOCKERFILE = "Dockerfile";
const APP_DOCKERFILE = "apps/community-bot/Dockerfile";
const REQUIRE_FLAG = "--require @opentelemetry/auto-instrumentations-node/register";
const REQUIRE_CMD =
  '["node", "--require", "@opentelemetry/auto-instrumentations-node/register", "dist/server.js"]';

const openServers: HttpServer[] = [];

type ShutdownTarget = {
  once(signal: NodeJS.Signals, handler: () => void | Promise<void>): unknown;
  exit(code?: number): void;
};

type ShutdownLogger = {
  info(bindings: Readonly<Record<string, unknown>>, message: string): void;
  error(bindings: Readonly<Record<string, unknown>>, message: string): void;
};

type RegisterTelemetryShutdown = (options?: {
  readonly target?: ShutdownTarget;
  readonly shutdown?: () => Promise<void>;
  readonly logger?: ShutdownLogger;
  readonly signals?: readonly NodeJS.Signals[];
}) => void;

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

describe("community bot OTel bootstrap — R-01 init before any import", () => {
  beforeEach(() => {
    telemetry.initTelemetry.mockClear();
    vi.resetModules();
  });

  it("makes the instrumentation import the first statement, ahead of probot, observability, and app", () => {
    // Given server.ts whose first statement is import "./instrumentation.js"
    const serverSource = readRepoFile(SERVER_SOURCE);
    const firstImport = firstNonHeaderStatement(serverSource);
    // Then `import "./instrumentation.js"` is the first statement
    expect(firstImport).toBe('import "./instrumentation.js";');
    // And initTelemetry() is invoked before the probot, observability logger, and ./app.js imports run
    const bootstrapIndex = serverSource.indexOf('import "./instrumentation.js";');
    for (const laterImport of ['from "probot"', 'from "@sovri/observability"', 'from "./app.js"']) {
      expect(bootstrapIndex).toBeLessThan(serverSource.indexOf(laterImport));
    }
  });

  it("calls initTelemetry exactly once as the only side effect of importing instrumentation.ts", async () => {
    // When the entry module is loaded
    await import(INSTRUMENTATION_MODULE);
    // Then importing "./instrumentation.js" calls initTelemetry() exactly once
    expect(telemetry.initTelemetry).toHaveBeenCalledTimes(1);
    // And it passes no argument (the bot reads no env value itself)
    expect(telemetry.initTelemetry).toHaveBeenCalledWith();
    // And the bootstrap module holds the initTelemetry() call and nothing instrumented ahead of it
    const source = readRepoFile(INSTRUMENTATION_SOURCE);
    expect(source).toContain("initTelemetry()");
    expect(source).not.toContain("probot");
  });
});

describe("community bot OTel bootstrap — R-01 idempotent double-load", () => {
  it("initializes telemetry only once when the bootstrap is reached twice in the same process", async () => {
    // Given the bootstrap is reachable both via node --require and the explicit import
    telemetry.initTelemetry.mockClear();
    vi.resetModules();
    // When the bootstrap side effect is reached a second time in the same process
    await import(INSTRUMENTATION_MODULE);
    await import(INSTRUMENTATION_MODULE);
    // Then initTelemetry() does not start a second NodeSDK (the ESM module is cached, init is once)
    expect(telemetry.initTelemetry).toHaveBeenCalledTimes(1);
  });
});

describe("community bot OTel bootstrap — R-02 no-op contract and transparency", () => {
  it("boots and serves /health and /version with no OTLP endpoint set", async () => {
    // Given OTEL_EXPORTER_OTLP_ENDPOINT is unset
    const restore = withEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: undefined });
    try {
      const baseUrl = getServerBaseUrl(await startCommunityBotServer());
      // Then GET /health returns 200 with body { "status": "ok" }
      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe('{"status":"ok"}');
      // And GET /version returns the version payload { version, node }
      const version = await fetch(`${baseUrl}/version`);
      expect(version.status).toBe(200);
      expect(await version.text()).toBe(expectedVersionResponseText());
    } finally {
      restore();
    }
  });

  it("invokes initTelemetry and serves the same operational responses when an OTLP endpoint is configured", async () => {
    // Given OTEL_EXPORTER_OTLP_ENDPOINT is "http://collector.example:4318"
    const restore = withEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example:4318" });
    try {
      // And initTelemetry is stubbed so no real OTLP connection is opened
      telemetry.initTelemetry.mockClear();
      vi.resetModules();
      // When the bot starts
      await import(INSTRUMENTATION_MODULE);
      // Then initTelemetry() is invoked
      expect(telemetry.initTelemetry).toHaveBeenCalledTimes(1);
      // And GET /health and /version answer unchanged (the bootstrap is transparent)
      const baseUrl = getServerBaseUrl(await startCommunityBotServer());
      const health = await fetch(`${baseUrl}/health`);
      const version = await fetch(`${baseUrl}/version`);
      expect(await health.text()).toBe('{"status":"ok"}');
      expect(await version.text()).toBe(expectedVersionResponseText());
    } finally {
      restore();
    }
  });
});

describe("community bot OTel bootstrap — R-03 graceful shutdown", () => {
  it.each<NodeJS.Signals>(["SIGTERM", "SIGINT"])(
    "awaits shutdownTelemetry on %s before the process exits",
    async (signal) => {
      const { register } = await loadShutdown();
      const target = createFakeTarget();
      const shutdown = vi.fn<() => Promise<void>>(async () => undefined);
      // Given the bot is running with telemetry initialized
      register({ target, shutdown, logger: silentLogger() });
      // When the process receives <signal>
      await target.fire(signal);
      // Then shutdownTelemetry() is awaited so spans flush, then the process exits
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(target.exit).toHaveBeenCalledWith(0);
      expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(
        target.exit.mock.invocationCallOrder[0],
      );
    },
  );

  it("does not start a second drain when a second termination signal arrives", async () => {
    const { register } = await loadShutdown();
    const target = createFakeTarget();
    const shutdown = vi.fn<() => Promise<void>>(async () => undefined);
    // Given the bot received SIGTERM and the shutdown is in progress
    register({ target, shutdown, logger: silentLogger() });
    // When a second SIGTERM or SIGINT arrives before the first completes
    await target.fire("SIGTERM");
    await target.fire("SIGINT");
    // Then the in-flight drain is awaited once and the process still exits cleanly
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(target.exit).toHaveBeenCalledTimes(1);
  });

  it("resolves cleanly when telemetry was never initialized", async () => {
    const { register } = await loadShutdown();
    const target = createFakeTarget();
    // Given telemetry is a no-op so shutdownTelemetry() resolves immediately
    const shutdown = vi.fn<() => Promise<void>>(async () => undefined);
    register({ target, shutdown, logger: silentLogger() });
    // When the process receives SIGTERM
    await expect(target.fire("SIGTERM")).resolves.toBeUndefined();
    // Then the process exits with a success code, no rejection
    expect(target.exit).toHaveBeenCalledWith(0);
  });

  it("still exits when the flush rejects instead of hanging the container", async () => {
    const { register } = await loadShutdown();
    const target = createFakeTarget();
    const logger = recordingLogger();
    // Given shutdownTelemetry() rejects because the underlying SDK flush throws
    const shutdown = vi.fn<() => Promise<void>>(async () => {
      throw new Error("otel drain failed");
    });
    register({ target, shutdown, logger });
    // When the process receives SIGTERM
    await expect(target.fire("SIGTERM")).resolves.toBeUndefined();
    // Then the handler catches the rejection, logs the flush failure, and still exits non-zero
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(target.exit).toHaveBeenCalledWith(1);
  });
});

describe("community bot OTel bootstrap — R-04 thin adapter", () => {
  it("constructs no telemetry internals anywhere in apps/community-bot/src", () => {
    // Then no NodeSDK, exporter, span, or metric is constructed in the bot
    const sources = [SERVER_SOURCE, INSTRUMENTATION_SOURCE, SHUTDOWN_SOURCE].map((path) =>
      readRepoFile(path),
    );
    for (const source of sources) {
      for (const forbidden of [
        "NodeSDK",
        "OTLPTraceExporter",
        "getNodeAutoInstrumentations",
        "recordMetric",
        "withSpan",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
    // And the only telemetry entry points used are initTelemetry() and shutdownTelemetry()
    expect(readRepoFile(INSTRUMENTATION_SOURCE)).toContain("initTelemetry");
    expect(readRepoFile(SHUTDOWN_SOURCE)).toContain("shutdownTelemetry");
  });
});

describe("community bot OTel bootstrap — R-05 logger unchanged", () => {
  it("keeps the createLogger boot sequence intact after the bootstrap import", () => {
    const serverSource = readRepoFile(SERVER_SOURCE);
    // Then it still calls createLogger("community-bot.server") and logs the startup line
    expect(serverSource).toContain('import { createLogger } from "@sovri/observability";');
    expect(serverSource).toContain('createLogger("community-bot.server")');
    expect(serverSource).toContain('logger.info("Sovri community-bot starting");');
    // And applyRuntimeEnvironmentDefaults() and run(app) still run in order
    expect(serverSource.indexOf("applyRuntimeEnvironmentDefaults()")).toBeLessThan(
      serverSource.indexOf("run(app);"),
    );
    expect(serverSource).toContain("run(app);");
  });
});

describe("community bot OTel bootstrap — R-06 --require startup form", () => {
  it("switches the start script to the auto-instrumentation --require form", () => {
    // Then the "start" script uses the --require form
    const scripts = readJsonObject("apps/community-bot/package.json").scripts;
    expect(isRecord(scripts) ? scripts.start : undefined).toBe(
      "node --require @opentelemetry/auto-instrumentations-node/register dist/server.js",
    );
  });

  it.each([ROOT_DOCKERFILE, APP_DOCKERFILE])(
    "switches the %s runtime CMD to the --require form",
    (path) => {
      const dockerfile = readRepoFile(path);
      // Then the runtime CMD uses the --require form
      expect(dockerfile).toContain(REQUIRE_CMD);
      expect(dockerfile).not.toContain('CMD ["node", "dist/server.js"]');
      // And the runtime image keeps EXPOSE 3000, the non-root sovri user, and the /health HEALTHCHECK
      expect(dockerfile).toContain("EXPOSE 3000");
      expect(dockerfile).toContain("USER sovri");
      expect(dockerfile).toContain("HEALTHCHECK");
      expect(dockerfile).toContain("/health");
    },
  );
});

describe("community bot OTel bootstrap — R-07 no secret leaks at bootstrap", () => {
  it("calls initTelemetry with no argument and references only OTEL_* env in the bootstrap path", () => {
    // Then the bootstrap passes no env value to telemetry and names no secret env var
    const sources = [SERVER_SOURCE, INSTRUMENTATION_SOURCE, SHUTDOWN_SOURCE].map((path) =>
      readRepoFile(path),
    );
    for (const source of sources) {
      for (const secretEnv of [
        "GITHUB_TOKEN",
        "PRIVATE_KEY",
        "WEBHOOK_SECRET",
        "ANTHROPIC_API_KEY",
        "MISTRAL_API_KEY",
      ]) {
        expect(source).not.toContain(secretEnv);
      }
    }
    expect(readRepoFile(INSTRUMENTATION_SOURCE)).toContain("initTelemetry()");
  });

  it("never includes process secrets in the shutdown failure log", async () => {
    const { register } = await loadShutdown();
    const target = createFakeTarget();
    const logger = recordingLogger();
    const restore = withEnv({ GITHUB_TOKEN: "LEAK_TOKEN_7F3A", WEBHOOK_SECRET: "LEAK_HMAC_2B19" });
    try {
      register({
        target,
        shutdown: async () => {
          throw new Error("drain failed");
        },
        logger,
      });
      await target.fire("SIGTERM");
    } finally {
      restore();
    }
    // Then no secret marker appears in any captured shutdown log payload
    const serialized = JSON.stringify(logger.error.mock.calls);
    expect(serialized).not.toContain("LEAK_TOKEN_7F3A");
    expect(serialized).not.toContain("LEAK_HMAC_2B19");
  });
});

describe("community bot OTel bootstrap — R-08 changelog and R-09 code quality", () => {
  it("records the OTel bootstrap in the changelog Unreleased section", () => {
    // Then CHANGELOG.md [Unreleased] gains a bot-scoped entry describing the bootstrap and --require form
    const unreleased = unreleasedSection(readRepoFile("CHANGELOG.md"));
    expect(unreleased.toLowerCase()).toContain("otel");
    expect(unreleased).toContain(REQUIRE_FLAG);
  });

  it.each([INSTRUMENTATION_SOURCE, SHUTDOWN_SOURCE])(
    "keeps %s within the code-quality contract",
    (path) => {
      const source = readRepoFile(path);
      // Then the new file carries the two-line SPDX header
      expect(
        source.startsWith("// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sovri SAS"),
      ).toBe(true);
      // And contains no any / unjustified suppression / oxlint-disable
      for (const forbidden of [": any", "@ts-ignore", "@ts-expect-error", "oxlint-disable"]) {
        expect(source).not.toContain(forbidden);
      }
      // And internal imports use explicit ".js" extensions
      for (const match of source.matchAll(/from "(\.[^"]+)"/gu)) {
        expect(match[1]).toMatch(/\.js$/u);
      }
    },
  );
});

async function loadShutdown(): Promise<{ readonly register: RegisterTelemetryShutdown }> {
  const module: unknown = await import(SHUTDOWN_MODULE);
  if (!isRecord(module) || typeof module.registerTelemetryShutdown !== "function") {
    throw new Error("apps/community-bot/src/shutdown.ts must export registerTelemetryShutdown");
  }
  return { register: module.registerTelemetryShutdown as RegisterTelemetryShutdown };
}

function createFakeTarget(): ShutdownTarget & {
  readonly exit: ReturnType<typeof vi.fn>;
  fire(signal: NodeJS.Signals): Promise<void>;
} {
  const handlers = new Map<NodeJS.Signals, () => void | Promise<void>>();
  const exit = vi.fn<(code?: number) => void>();
  return {
    once(signal: NodeJS.Signals, handler: () => void | Promise<void>) {
      handlers.set(signal, handler);
      return this;
    },
    exit,
    async fire(signal: NodeJS.Signals) {
      await handlers.get(signal)?.();
    },
  };
}

function silentLogger(): ShutdownLogger {
  return { info: () => undefined, error: () => undefined };
}

function recordingLogger(): { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), error: vi.fn() };
}

function withEnv(overrides: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function firstNonHeaderStatement(source: string): string {
  return (
    source
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("//")) ?? ""
  );
}

function unreleasedSection(changelog: string): string {
  // Anchor on the heading, not a bare "[Unreleased]" — the preamble prose also mentions the token.
  const heading = "## [Unreleased]";
  const start = changelog.indexOf(heading);
  if (start === -1) {
    return "";
  }
  const rest = changelog.slice(start + heading.length);
  const nextRelease = rest.search(/\n## \[/u);
  return nextRelease === -1 ? rest : rest.slice(0, nextRelease);
}

async function startCommunityBotServer(): Promise<HttpServer> {
  const middleware = await createNodeMiddleware(app, {
    probot: new Probot({
      githubToken: "test-token",
      log: createLogger("community-bot.otel-bootstrap-test"),
    }),
  });
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.writeHead(404).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  openServers.push(server);
  return server;
}

function getServerBaseUrl(server: HttpServer): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function expectedVersionResponseText(): string {
  const version = readJsonObject("apps/community-bot/package.json").version;
  if (typeof version !== "string") {
    throw new Error("Expected community bot package version to be a string");
  }
  return JSON.stringify({ version, node: "24.x" });
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
