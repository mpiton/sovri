// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { z } from "zod";

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
    // This task ships the TRACE lifecycle only (metrics are task-126). Passing explicit empty
    // arrays stops NodeSDK from auto-configuring metric/log exporters from OTEL_METRICS_EXPORTER /
    // OTEL_LOGS_EXPORTER (which default to OTLP when unset) — keeping init trace-only and the
    // env boundary closed.
    metricReaders: [],
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
 * Drain the started SDK and clear the handle. Resolves cleanly when nothing was started and is
 * safe to call repeatedly; a later {@link initTelemetry} then starts a fresh SDK.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk === undefined) {
    return; // R-06: nothing started — resolve cleanly.
  }
  const current = sdk;
  sdk = undefined; // Clear first so a later init starts fresh and a repeat shutdown no-ops.
  await current.shutdown();
}
