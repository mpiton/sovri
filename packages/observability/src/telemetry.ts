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

export function initTelemetry(): void {
  if (sdk !== undefined) {
    return; // R-05: an SDK is already started — a further init is a no-op.
  }

  const env: TelemetryEnv = TelemetryEnvSchema.parse(process.env);
  const endpoint = envOrUndefined(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (endpoint === undefined) {
    return; // R-01: no OTLP endpoint configured — OTel stays a complete no-op.
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: envOrUndefined(env.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: envOrUndefined(env.OTEL_SERVICE_VERSION) ?? DEFAULT_SERVICE_VERSION,
  });

  const started = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
      new PinoInstrumentation({ disableLogSending: false }),
    ],
  });
  started.start();
  sdk = started;
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk === undefined) {
    return; // R-06: nothing started — resolve cleanly.
  }
  const current = sdk;
  sdk = undefined; // Clear first so a later init starts fresh and a repeat shutdown no-ops.
  await current.shutdown();
}
