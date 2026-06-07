// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { z } from "zod";

import { createPrometheusReader } from "./metrics-reader.js";

// OTel SDK init/shutdown lifecycle for @sovri/observability (ARCHI §10.2.1, docs/adr/019,
// revising docs/adr/006). Additive to the package: the createLogger/Logger surface is untouched.
// SDK lifecycle only — the metrics meter and withSpan/recordMetric helpers are a later task.

// Telemetry reads exactly these three env vars into the SDK config — no GitHub token, LLM key,
// or raw webhook payload ever reaches a span or the exporter. The schema is the single read
// boundary; the type is derived via z.infer.
const TelemetryEnvSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_SERVICE_VERSION: z.string().optional(),
});
type TelemetryEnv = z.infer<typeof TelemetryEnvSchema>;

const DEFAULT_SERVICE_NAME = "sovri-community-bot";
const DEFAULT_SERVICE_VERSION = "0.0.0";

// Module-scoped, nullable handle for the started NodeSDK. Holds the running SDK so
// shutdownTelemetry() can drain it; undefined when nothing runs, which makes a second
// initTelemetry() and a repeated shutdownTelemetry() safe no-ops.
let sdk: NodeSDK | undefined;

// In-flight shutdown promise. While a drain is running, concurrent shutdownTelemetry() calls
// share this promise (one drain, not N) and initTelemetry() stays a no-op because `sdk` is only
// cleared once the drain and deregistration finish.
let shuttingDown: Promise<void> | undefined;

// Mirror logger.ts's "empty == unset" convention: an absent, empty, or whitespace-only value
// is treated as unset. Common in docker-compose / Helm where an unset var expands to "".
function envOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Start the OpenTelemetry trace SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; a complete no-op
 * otherwise. Safe to call more than once — a second call is a no-op while an SDK is running.
 */
export function initTelemetry(): void {
  if (sdk !== undefined) {
    return; // R-05: an SDK is already started — a further init is a no-op.
  }

  const env: TelemetryEnv = TelemetryEnvSchema.parse(process.env);
  // Strip trailing slashes so a collector URL like "http://host:4318/" yields
  // ".../v1/traces", not the broken "...//v1/traces".
  const endpoint = envOrUndefined(env.OTEL_EXPORTER_OTLP_ENDPOINT)?.replace(/\/+$/u, "");
  if (endpoint === undefined || endpoint.length === 0) {
    return; // R-01: no OTLP endpoint configured — OTel stays a complete no-op.
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: envOrUndefined(env.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: envOrUndefined(env.OTEL_SERVICE_VERSION) ?? DEFAULT_SERVICE_VERSION,
  });

  const started = new NodeSDK({
    // Keep the closed env boundary (R-08): without this, NodeSDK's default env detector reads
    // OTEL_RESOURCE_ATTRIBUTES / OTEL_NODE_RESOURCE_DETECTORS at runtime and could override the
    // service.name/version resolved above. Only the three OTEL_ vars in the schema feed the SDK.
    autoDetectResources: false,
    // Register the single shared Prometheus reader so /metrics can serve the aggregated sovri.*
    // registry — built with preventServerStart:true, it opens no second port. logRecordProcessors
    // stays explicitly empty so NodeSDK does not auto-configure a log exporter from OTEL_LOGS_EXPORTER
    // (which defaults to OTLP when unset), keeping the env boundary closed.
    metricReaders: [createPrometheusReader()],
    logRecordProcessors: [],
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        // Disable the bundled Pino instrumentation so the standalone instance below is the single
        // authoritative one — otherwise Pino is instrumented twice (double log-correlation hooks).
        "@opentelemetry/instrumentation-pino": { enabled: false },
      }),
      new PinoInstrumentation({ disableLogSending: false }),
    ],
  });
  started.start();
  sdk = started;
}

/**
 * Drain the started SDK, deregister the OTel globals, and clear the handle. Resolves cleanly when
 * nothing was started, coalesces concurrent calls into a single drain, and is safe to call
 * repeatedly; a later {@link initTelemetry} then starts a fresh SDK.
 */
export function shutdownTelemetry(): Promise<void> {
  if (shuttingDown !== undefined) {
    return shuttingDown; // A drain is already running — coalesce, don't drain the SDK twice.
  }
  if (sdk === undefined) {
    return Promise.resolve(); // R-06: nothing started — resolve cleanly.
  }
  const current = sdk;
  shuttingDown = (async (): Promise<void> => {
    try {
      await current.shutdown();
    } finally {
      // NodeSDK.start() registers the global trace/context/propagation/metric providers, but
      // NodeSDK.shutdown() does not remove them. Without deregistering, a later initTelemetry()
      // hits "Attempted duplicate registration of API: trace" and the fresh provider is silently
      // dropped — spans would keep routing to the already-shut-down provider. Run this in
      // `finally` so a rejected drain still deregisters and a later init can re-register (R-06).
      context.disable();
      propagation.disable();
      trace.disable();
      metrics.disable();
      // NodeSDK also registers an (empty, trace-only) global logger provider via @opentelemetry/
      // api-logs; deregister it too so a restart doesn't "duplicate registration of API: logs".
      logs.disable();
      // Clear the handles LAST. While the drain is in flight `sdk` stays set, so a concurrent
      // initTelemetry() no-ops (R-05) rather than starting a second SDK whose freshly registered
      // globals this `finally` would then disable.
      sdk = undefined;
      shuttingDown = undefined;
    }
  })();
  return shuttingDown;
}
