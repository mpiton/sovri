// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export { createLogger } from "./logger.js";
export type { Logger } from "./logger.js";
export { initTelemetry, shutdownTelemetry } from "./telemetry.js";
export { withSpan, recordMetric } from "./tracing.js";
export type { InstrumentDescriptor, SpanAttributeValue, SpanLike } from "./tracing.js";
export {
  createPrometheusReader,
  getPrometheusExporter,
  collectPrometheusText,
} from "./metrics-reader.js";
