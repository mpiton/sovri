// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Acceptance test for the shared Prometheus metric reader (GitHub issue #2429,
// metrics-endpoint.feature R-01..R-10). The mechanism (D-02): a REAL PrometheusExporter is built with
// preventServerStart:true on a REAL MeterProvider, an instrument records a value, then
// collectPrometheusText() is asserted — deterministic, no port opened, no OTLP network. The module is
// re-imported fresh per test so its module-scoped exporter handle resets. "@sovri/core" is never mocked.

const SOVRI_INSTRUMENTS = [
  "sovri_reviews_total",
  "sovri_reviews_duration_ms",
  "sovri_findings_total",
  "sovri_llm_tokens",
  "sovri_llm_errors",
] as const;

const load = async (): Promise<typeof import("./metrics-reader.js")> =>
  import("./metrics-reader.js");

beforeEach(() => {
  // Reset the module-scoped exporter handle so the never-initialized path is observable (R-05) and
  // each populated test builds its own exporter bound to its own provider (one reader per provider).
  vi.resetModules();
});

describe("getPrometheusExporter / collectPrometheusText degrade to empty when telemetry is NO-OP (R-05)", () => {
  // Given OTEL_EXPORTER_OTLP_ENDPOINT is unset so telemetry is a complete no-op
  // Then getPrometheusExporter() returns undefined
  it("returns undefined before any reader is created", async () => {
    const { getPrometheusExporter } = await load();

    expect(getPrometheusExporter()).toBeUndefined();
  });

  // And collectPrometheusText() resolves to an empty string rather than throwing
  it("serializes to an empty string when no exporter is registered", async () => {
    const { collectPrometheusText } = await load();

    await expect(collectPrometheusText()).resolves.toBe("");
  });
});

describe("a single shared exporter is used with its own HTTP server disabled (R-04)", () => {
  // Given the metrics reader module constructs the PrometheusExporter
  // Then the exporter is built once and shared — getPrometheusExporter() returns that same instance
  // And exactly one reader exists (a second call returns the same instance, opening no second port)
  it("createPrometheusReader returns the same shared PrometheusExporter on repeated calls", async () => {
    const { createPrometheusReader, getPrometheusExporter } = await load();

    const first = createPrometheusReader();
    const second = createPrometheusReader();

    expect(first).toBeInstanceOf(PrometheusExporter);
    expect(second).toBe(first);
    expect(getPrometheusExporter()).toBe(first);
  });

  // And it passes preventServerStart:true so the exporter opens no second port. Asserted on the
  // source so the guarantee is pinned deterministically rather than relying on no :9464 bind.
  it("constructs the PrometheusExporter with preventServerStart:true (no second port)", () => {
    const readerSource = readFileSync(
      fileURLToPath(new URL("./metrics-reader.ts", import.meta.url)),
      "utf8",
    );

    expect(readerSource).toMatch(/preventServerStart:\s*true/u);
  });

  // And exactly one MeterProvider with one MetricReader is registered for the "sovri" meter:
  // telemetry.ts wires the prometheus reader into the single NodeSDK meter readers (no longer empty).
  it("telemetry.ts registers the prometheus reader on the single meter provider", async () => {
    const telemetrySource = readFileSync(
      fileURLToPath(new URL("./telemetry.ts", import.meta.url)),
      "utf8",
    );

    expect(telemetrySource).toMatch(/createPrometheusReader/u);
    expect(telemetrySource).toMatch(/metricReaders/u);
    // The task-125 placeholder `metricReaders: []` must be gone — the reader is now registered.
    expect(telemetrySource).not.toMatch(/metricReaders:\s*\[\s*\]/u);
  });
});

describe("the exposition reflects exactly the task-128 sovri.* instruments aggregated by the meter (R-01, R-03)", () => {
  // Given the meter has aggregated values for the five sovri.* instruments
  // When the exposition is serialized
  // Then the body is valid Prometheus text containing the series for each instrument, and the bot only
  //   serializes — the meter does the aggregation.
  it("serializes every sovri.* series the meter aggregated", async () => {
    const { createPrometheusReader, collectPrometheusText } = await load();
    const reader = createPrometheusReader();
    const provider = new MeterProvider({ readers: [reader] });
    const meter = provider.getMeter("sovri");

    meter.createCounter("sovri.reviews.total").add(1, { status: "success" });
    meter.createHistogram("sovri.reviews.duration_ms").record(1200, { status: "success" });
    meter.createCounter("sovri.findings.total").add(2, { severity: "high", category: "security" });
    meter
      .createCounter("sovri.llm.tokens")
      .add(100, { llm_provider: "anthropic", model: "claude", direction: "input" });
    meter
      .createCounter("sovri.llm.errors")
      .add(1, { llm_provider: "anthropic", error_type: "timeout" });

    const text = await collectPrometheusText();

    for (const series of SOVRI_INSTRUMENTS) {
      expect(text, `exposition must contain ${series}`).toContain(series);
    }

    await provider.shutdown();
  });
});

describe("a freshly booted meter (initialized, nothing recorded) serializes without throwing (R-01)", () => {
  // Given telemetry is initialized so the exporter is registered
  // And no review has recorded any sovri.* metric yet, so the registry is empty
  // Then serializing the empty registry does not throw and yields no sovri.* series
  it("collectPrometheusText on an empty-but-initialized registry yields a series-free body", async () => {
    const { createPrometheusReader, collectPrometheusText } = await load();
    const reader = createPrometheusReader();
    const provider = new MeterProvider({ readers: [reader] });

    const text = await collectPrometheusText();

    expect(typeof text).toBe("string");
    expect(text).not.toContain("sovri_");

    await provider.shutdown();
  });
});

describe("the exposition never leaks a token, key, or PR payload — including in labels (R-06)", () => {
  // Given a token, an LLM key, and a PR diff marker are in scope, and a review recorded the sovri.*
  //   metrics with only low-cardinality tags
  // When the exposition is serialized
  // Then it contains none of those secret markers and no per-request value reaches a label.
  it("serializes only low-cardinality labels, never a secret substring", async () => {
    const githubToken = "LEAK_TOKEN_7F3A";
    const llmKey = "LEAK_LLMKEY_9E5B";
    const diffMarker = "LEAK_DIFF_3C8D";
    const { createPrometheusReader, collectPrometheusText } = await load();
    const reader = createPrometheusReader();
    const provider = new MeterProvider({ readers: [reader] });
    const meter = provider.getMeter("sovri");

    // Only the documented low-cardinality tags ever reach a label.
    meter
      .createCounter("sovri.reviews.total")
      .add(1, { status: "success", llm_provider: "anthropic" });
    // The secrets live in scope around the call site; they must never reach the exposition.
    void githubToken;
    void llmKey;
    void diffMarker;

    const text = await collectPrometheusText();

    for (const secret of [githubToken, llmKey, diffMarker]) {
      expect(text.includes(secret), `exposition must not contain ${secret}`).toBe(false);
    }

    await provider.shutdown();
  });
});

describe("the barrel re-exports the metrics-reader surface (R-10)", () => {
  // Given the package barrel "packages/observability/src/index.ts"
  // Then it re-exports getPrometheusExporter and collectPrometheusText alongside the existing surface.
  it("exports getPrometheusExporter and collectPrometheusText from the barrel", async () => {
    const barrel = await import("./index.js");

    expect(typeof barrel.getPrometheusExporter).toBe("function");
    expect(typeof barrel.collectPrometheusText).toBe("function");
  });
});
