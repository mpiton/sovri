// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Counter, Histogram, MetricOptions } from "@opentelemetry/api";
import { z } from "zod";

// Generic span/metric facade over @opentelemetry/api (docs/adr/019). Pure facade: the SDK/exporter
// wiring lives in telemetry.ts. @opentelemetry/api hands back no-op tracers/meters until an SDK is
// started, which is what makes the uninitialized path safe — there is no is-initialized branch here.

const TRACER_NAME = "sovri";
const METER_NAME = "sovri";

// Instrument model — Zod is the source of truth; the public type is derived via z.infer (R-10).
// The schema stays module-private: only recordMetric validates against it.
const InstrumentDescriptorSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["counter", "histogram"]),
  unit: z.string().optional(),
  description: z.string().optional(),
});

export type InstrumentDescriptor = z.infer<typeof InstrumentDescriptorSchema>;

// Thrown when a descriptor fails the instrument model, with the Zod rejection as `cause` (R-06).
// An unmodelled instrument is a programming error: fail fast rather than silently emit it.
class InvalidInstrumentError extends Error {
  constructor(cause: unknown) {
    super("Invalid metric instrument descriptor", { cause });
    this.name = "InvalidInstrumentError";
  }
}

// Scalar attribute value accepted on a span — the safe, non-array subset of OTel's attribute type.
export type SpanAttributeValue = string | number | boolean;

// Minimal span handle forwarded to `fn`, narrowing OTel's `Span` to attribute-setting only. Lets a
// caller stamp an attribute computed inside the operation (e.g. a count known only after the work)
// without importing `@opentelemetry/*`. The real OTel `Span` satisfies it structurally.
export interface SpanLike {
  setAttribute(key: string, value: SpanAttributeValue): void;
}

/**
 * Run an async operation inside an active OTel span. Transparent pass-through: returns fn's
 * resolved value unchanged (R-01); on reject, records the exception and an ERROR status then
 * rethrows the original error (R-02); always ends the span exactly once in finally (R-03).
 * Safe when telemetry was never initialized — the no-op tracer still runs fn (R-04). The active
 * span is forwarded to `fn` as a {@link SpanLike} so callers can set attributes computed during
 * the operation; existing zero-argument callers are unaffected.
 */
export function withSpan<T>(
  name: string,
  fn: (span: SpanLike) => Promise<T>,
  attributes?: Record<string, SpanAttributeValue>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span): Promise<T> => {
    try {
      if (attributes) {
        span.setAttributes(attributes);
      }
      return await fn(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Module-scoped instrument caches, one per kind so a cached instrument keeps its precise type
// without an `as` cast. Keyed by name; reuse is process-wide and assertable (R-05).
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

// Build MetricOptions without explicit `undefined` keys — exactOptionalPropertyTypes rejects
// `{ unit: undefined }` against OTel's `unit?: string`, so omit the key when absent.
function toMetricOptions(descriptor: InstrumentDescriptor): MetricOptions {
  return {
    ...(descriptor.unit !== undefined ? { unit: descriptor.unit } : {}),
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
  };
}

function getCounter(descriptor: InstrumentDescriptor): Counter {
  const cached = counters.get(descriptor.name);
  if (cached) {
    return cached;
  }
  const counter = metrics
    .getMeter(METER_NAME)
    .createCounter(descriptor.name, toMetricOptions(descriptor));
  counters.set(descriptor.name, counter);
  return counter;
}

function getHistogram(descriptor: InstrumentDescriptor): Histogram {
  const cached = histograms.get(descriptor.name);
  if (cached) {
    return cached;
  }
  const histogram = metrics
    .getMeter(METER_NAME)
    .createHistogram(descriptor.name, toMetricOptions(descriptor));
  histograms.set(descriptor.name, histogram);
  return histogram;
}

/**
 * Emit a counter increment or histogram value through the single "sovri" meter. The descriptor is
 * validated against the instrument model (R-06); the instrument is created lazily and cached by
 * name (R-05), then the value is routed by kind with string-keyed tags (R-07). A no-op when
 * telemetry was never initialized — the no-op meter's instruments swallow the value (R-04).
 */
export function recordMetric(
  descriptor: InstrumentDescriptor,
  value: number,
  tags?: Record<string, string>,
): void {
  const parsed = InstrumentDescriptorSchema.safeParse(descriptor);
  if (!parsed.success) {
    throw new InvalidInstrumentError(parsed.error);
  }
  const valid = parsed.data;
  if (valid.kind === "counter") {
    getCounter(valid).add(value, tags);
  } else {
    getHistogram(valid).record(value, tags);
  }
}
