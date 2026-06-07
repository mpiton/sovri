// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

// Shared Prometheus metric reader for @sovri/observability (docs/adr/019, ARCHI §10.2.3). Owns the
// single PrometheusExporter that telemetry.ts registers as the MeterProvider's MetricReader, plus the
// pure accessor and the text serializer the bot's /metrics arm serves.
//
// RED STUB — signatures only so the acceptance tests compile and fail at runtime for the right reason.
// GREEN wires: a module-scoped, cached, shared exporter (built once, preventServerStart:true) returned
// by getPrometheusExporter() after telemetry init, and collectPrometheusText() = exporter.collect() +
// PrometheusSerializer().serialize(resourceMetrics), returning "" when no exporter is registered.

/**
 * Build (or return the already-built) shared {@link PrometheusExporter}. Constructed with its built-in
 * HTTP server disabled (`preventServerStart: true`) so it opens no second port — the bot serves the
 * registry itself. Called by `initTelemetry()` and registered on the single meter provider.
 */
export function createPrometheusReader(): PrometheusExporter {
  return new PrometheusExporter({ preventServerStart: true });
}

/**
 * The shared exporter once telemetry has been initialized, or `undefined` when telemetry is a NO-OP
 * (`OTEL_EXPORTER_OTLP_ENDPOINT` unset) and no reader was ever created.
 */
export function getPrometheusExporter(): PrometheusExporter | undefined {
  return undefined;
}

/**
 * Serialize the aggregated registry to Prometheus text exposition, or `""` when no exporter is
 * registered so the HTTP layer can still answer 200 with an empty-but-valid body.
 */
export function collectPrometheusText(): Promise<string> {
  return Promise.resolve("");
}
