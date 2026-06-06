// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Acceptance test for the OTel SDK init/shutdown lifecycle (GitHub issue #2401, feature
// telemetry-init.feature). The OTel SDK is stubbed at the module boundary — no scenario
// dials a real OTLP collector; the exporter URL is asserted on the captured config, never sent.
// Rules R-01..R-08 (R-09 is a non-business gate enforced by tsc + oxlint + oxfmt).

interface ExporterConfig {
  readonly url?: string;
}
interface PinoConfig {
  readonly disableLogSending?: boolean;
}
type AutoInstrConfig = Readonly<Record<string, { readonly enabled?: boolean }>>;
type ResourceAttrs = Readonly<Record<string, unknown>>;

// Hoisted capture spies shared with the vi.mock factories below. Each OTel collaborator is a
// plain `vi.fn` rather than a class: a `vi.fn` returning an object becomes the `new` instance, so
// `new NodeSDK(...)` yields `{ start, shutdown }` while `nodeSdkCtor.mock.calls` records construction.
const mocks = vi.hoisted(() => {
  const startSpy = vi.fn();
  const shutdownSpy = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const nodeSdkCtor = vi.fn(() => ({ start: startSpy, shutdown: shutdownSpy }));
  const otlpCtor = vi.fn<(config: ExporterConfig) => void>();
  const autoInstr = vi.fn<(config: AutoInstrConfig) => string>(() => "auto-instrumentations");
  const pinoCtor = vi.fn<(config: PinoConfig) => void>();
  const resourceFrom = vi.fn<(attrs: ResourceAttrs) => { readonly attributes: ResourceAttrs }>(
    (attrs) => ({ attributes: attrs }),
  );
  return { startSpy, shutdownSpy, nodeSdkCtor, otlpCtor, autoInstr, pinoCtor, resourceFrom };
});

vi.mock("@opentelemetry/sdk-node", () => ({ NodeSDK: mocks.nodeSdkCtor }));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({ OTLPTraceExporter: mocks.otlpCtor }));
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: mocks.autoInstr,
}));
vi.mock("@opentelemetry/instrumentation-pino", () => ({ PinoInstrumentation: mocks.pinoCtor }));
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: mocks.resourceFrom }));

const OTEL_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "OTEL_SERVICE_VERSION",
] as const;

const loadTelemetry = async (): Promise<typeof import("./telemetry.js")> =>
  import("./telemetry.js");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Start every scenario from a clean env: the three OTEL_ vars unset.
  for (const key of OTEL_KEYS) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("initTelemetry — no-op when the OTLP endpoint is not configured (R-01)", () => {
  // Given the environment variable "OTEL_EXPORTER_OTLP_ENDPOINT" is <absent | "" | "  ">
  // When initTelemetry() is called
  // Then no NodeSDK is constructed, no SDK start is attempted, and it returns without throwing.
  it.each([
    ["absent", undefined],
    ['the empty string ""', ""],
    ['the whitespace string "  "', "  "],
  ])("stays a complete no-op when the endpoint is %s", async (_label, value) => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", value);
    const { initTelemetry } = await loadTelemetry();

    expect(() => initTelemetry()).not.toThrow();

    expect(mocks.nodeSdkCtor).not.toHaveBeenCalled();
    expect(mocks.startSpy).not.toHaveBeenCalled();
  });
});

describe("initTelemetry — starts the OTLP trace SDK when the endpoint is set (R-02, R-04)", () => {
  // Given OTEL_EXPORTER_OTLP_ENDPOINT is "http://localhost:4318"
  // When initTelemetry() is called
  // Then exactly one NodeSDK is constructed and started once, the exporter url is exactly
  //   "http://localhost:4318/v1/traces", fs + dns instrumentation are disabled, and a
  //   PinoInstrumentation with disableLogSending:false is included.
  it("constructs and starts one NodeSDK with the OTLP trace exporter and instrumentation set", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const { initTelemetry } = await loadTelemetry();

    initTelemetry();

    expect(mocks.nodeSdkCtor).toHaveBeenCalledTimes(1);
    expect(mocks.startSpy).toHaveBeenCalledTimes(1);

    expect(mocks.otlpCtor.mock.calls.at(0)?.[0]?.url).toBe("http://localhost:4318/v1/traces");

    const autoCfg = mocks.autoInstr.mock.calls.at(0)?.[0];
    expect(autoCfg?.["@opentelemetry/instrumentation-fs"]?.enabled).toBe(false);
    expect(autoCfg?.["@opentelemetry/instrumentation-dns"]?.enabled).toBe(false);

    expect(mocks.pinoCtor.mock.calls.at(0)?.[0]?.disableLogSending).toBe(false);
  });
});

describe("initTelemetry — the SDK resource carries service identity (R-03)", () => {
  // Given OTEL_EXPORTER_OTLP_ENDPOINT is "http://localhost:4318"
  // And OTEL_SERVICE_NAME / OTEL_SERVICE_VERSION are <env-provided | absent>
  // When initTelemetry() is called
  // Then service.name / service.version come from env when present, else the documented fallbacks.
  it.each([
    ["edge-bot", "1.4.2", "edge-bot", "1.4.2"],
    [undefined, undefined, "sovri-community-bot", "0.0.0"],
  ])(
    "resolves service.name=%s service.version=%s to %s / %s",
    async (nameEnv, versionEnv, expectedName, expectedVersion) => {
      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
      vi.stubEnv("OTEL_SERVICE_NAME", nameEnv);
      vi.stubEnv("OTEL_SERVICE_VERSION", versionEnv);
      const { initTelemetry } = await loadTelemetry();

      initTelemetry();

      const attrs = mocks.resourceFrom.mock.calls.at(0)?.[0];
      expect(attrs?.[ATTR_SERVICE_NAME]).toBe(expectedName);
      expect(attrs?.[ATTR_SERVICE_VERSION]).toBe(expectedVersion);
    },
  );
});

describe("initTelemetry — double-init safety (R-05)", () => {
  // Given the SDK is already started
  // When initTelemetry() is called again
  // Then no second NodeSDK is constructed and the start count remains one.
  it("does not start a second SDK on a repeated init", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const { initTelemetry } = await loadTelemetry();

    initTelemetry();
    initTelemetry();

    expect(mocks.nodeSdkCtor).toHaveBeenCalledTimes(1);
    expect(mocks.startSpy).toHaveBeenCalledTimes(1);
  });
});

describe("shutdownTelemetry — drain safety (R-06)", () => {
  // Given initTelemetry() has not been called
  // When shutdownTelemetry() is awaited
  // Then it resolves without throwing and no SDK shutdown is attempted.
  it("resolves cleanly when no SDK was started", async () => {
    const { shutdownTelemetry } = await loadTelemetry();

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    expect(mocks.shutdownSpy).not.toHaveBeenCalled();
  });

  // Given the SDK is started
  // When shutdownTelemetry() is awaited, then awaited a second time
  // Then the SDK is drained exactly once and the second call resolves without a further drain.
  it("drains a started SDK exactly once and is repeatable", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const { initTelemetry, shutdownTelemetry } = await loadTelemetry();

    initTelemetry();
    await shutdownTelemetry();
    expect(mocks.shutdownSpy).toHaveBeenCalledTimes(1);

    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    expect(mocks.shutdownSpy).toHaveBeenCalledTimes(1);
  });

  // Given the SDK was started then fully shut down
  // When initTelemetry() is called again
  // Then a fresh NodeSDK is constructed and started (total start count is two).
  it("starts a fresh SDK after a full shutdown", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const { initTelemetry, shutdownTelemetry } = await loadTelemetry();

    initTelemetry();
    await shutdownTelemetry();
    initTelemetry();

    expect(mocks.nodeSdkCtor).toHaveBeenCalledTimes(2);
    expect(mocks.startSpy).toHaveBeenCalledTimes(2);
  });
});

describe("barrel — the package surface is additive (R-07)", () => {
  const barrelSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

  // Given the package barrel "packages/observability/src/index.ts"
  // Then it re-exports createLogger with an unchanged signature and the Logger type
  //   (asserted at source level — the type erases at runtime).
  it("keeps the logger surface re-exported unchanged", () => {
    expect(barrelSource).toMatch(
      /export\s*\{\s*createLogger\s*\}\s*from\s*["']\.\/logger\.js["']/u,
    );
    expect(barrelSource).toMatch(
      /export\s+type\s*\{\s*Logger\s*\}\s*from\s*["']\.\/logger\.js["']/u,
    );
  });

  // Then it also re-exports initTelemetry and shutdownTelemetry.
  it("re-exports the logger surface plus the telemetry lifecycle", async () => {
    const barrel = await import("./index.js");

    expect(typeof barrel.createLogger).toBe("function");
    expect(typeof barrel.initTelemetry).toBe("function");
    expect(typeof barrel.shutdownTelemetry).toBe("function");
    expect(barrelSource).toMatch(
      /export\s*\{[^}]*\binitTelemetry\b[^}]*\bshutdownTelemetry\b[^}]*\}\s*from\s*["']\.\/telemetry\.js["']/u,
    );
  });

  it("has no SDK side effect at import time when no endpoint is set", async () => {
    await import("./index.js");

    expect(mocks.nodeSdkCtor).not.toHaveBeenCalled();
    expect(mocks.startSpy).not.toHaveBeenCalled();
  });
});

describe("initTelemetry — secret-bearing env never reaches the SDK config (R-08)", () => {
  // Given the endpoint is set and a GitHub token, an LLM API key, and a raw webhook payload
  //   are present in the environment
  // When initTelemetry() is called
  // Then only the OTEL_ endpoint / name / version feed the SDK; no secret value reaches the
  //   resource attributes or the OTLPTraceExporter config.
  it("keeps tokens, keys, and payloads out of the resource and exporter config", async () => {
    const githubToken = "ghs_super_secret_github_token";
    const llmKey = "sk-ant-secret-llm-key";
    const webhookPayload = '{"action":"opened","secret":"raw-webhook-body"}';
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    vi.stubEnv("GITHUB_TOKEN", githubToken);
    vi.stubEnv("ANTHROPIC_API_KEY", llmKey);
    vi.stubEnv("SOVRI_WEBHOOK_PAYLOAD", webhookPayload);
    const { initTelemetry } = await loadTelemetry();

    initTelemetry();

    const attrs = mocks.resourceFrom.mock.calls.at(0)?.[0] ?? {};
    expect(Object.keys(attrs).toSorted()).toEqual(
      [ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION].toSorted(),
    );

    const serialized = JSON.stringify({
      attrs,
      exporter: mocks.otlpCtor.mock.calls.at(0)?.[0] ?? {},
    });
    for (const secret of [githubToken, llmKey, webhookPayload]) {
      expect(serialized.includes(secret), `SDK config must not contain ${secret}`).toBe(false);
    }
  });
});
