// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { PrometheusExporter, PrometheusSerializer } from "@opentelemetry/exporter-prometheus";

// Shared Prometheus metric reader for @sovri/observability (docs/adr/019, ARCHI §10.2.3). Owns the
// single PrometheusExporter that telemetry.ts registers as the MeterProvider's MetricReader, plus the
// pure accessor and the text serializer the bot's /metrics arm serves. No aggregation lives here — the
// meter provider aggregates; this module only builds the reader and renders its registry to text.

// Module-scoped, nullable handle for the shared exporter. Set the first time createPrometheusReader()
// runs (called by initTelemetry only when an OTLP endpoint is configured), so it stays undefined when
// telemetry is a NO-OP — which is exactly what getPrometheusExporter() reports.
let exporter: PrometheusExporter | undefined;

// One serializer is enough: it is stateless across calls (it renders the snapshot handed to it).
const serializer = new PrometheusSerializer();

/**
 * Build (or return the already-built) shared {@link PrometheusExporter}. Constructed with its built-in
 * HTTP server disabled (`preventServerStart: true`) so it opens no second port — the bot serves the
 * registry itself. Called by `initTelemetry()` and registered on the single meter provider; idempotent,
 * so a repeated init reuses the one exporter rather than opening another.
 */
export function createPrometheusReader(): PrometheusExporter {
  exporter ??= new PrometheusExporter({ preventServerStart: true });
  return exporter;
}

/**
 * The shared exporter once telemetry has been initialized, or `undefined` when telemetry is a NO-OP
 * (`OTEL_EXPORTER_OTLP_ENDPOINT` unset) and no reader was ever created.
 */
export function getPrometheusExporter(): PrometheusExporter | undefined {
  return exporter;
}

/**
 * Serialize the aggregated registry to Prometheus text exposition, or `""` when no exporter is
 * registered so the HTTP layer can still answer 200 with an empty-but-valid body. The exporter is only
 * collected when present, so its MetricReader is always bound to the meter provider here.
 */
export async function collectPrometheusText(): Promise<string> {
  if (exporter === undefined) {
    return "";
  }
  const { resourceMetrics } = await exporter.collect();
  return serializer.serialize(resourceMetrics);
}
