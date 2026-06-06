// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// RED scaffold (GitHub issue #2406). Signatures + type surface only — green-cycle implements the
// generic span/metric facade over @opentelemetry/api (docs/adr/019). The bodies are intentionally
// unimplemented so the acceptance test in tracing.test.ts fails for the right reason (no tracer
// obtained, no span ended, no instrument created/validated) rather than a missing-module compile
// error. green-cycle also derives InstrumentDescriptor from a Zod schema via z.infer (R-10).

export type InstrumentKind = "counter" | "histogram";

export interface InstrumentDescriptor {
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly unit?: string;
  readonly description?: string;
}

export async function withSpan<T>(
  _name: string,
  fn: () => Promise<T>,
  _attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  // Unimplemented: green-cycle runs fn inside an active span, records the exception and ERROR
  // status on reject, and ends the span in finally.
  return fn();
}

export function recordMetric(
  _descriptor: InstrumentDescriptor,
  _value: number,
  _tags?: Record<string, string>,
): void {
  // Unimplemented: green-cycle validates the descriptor against the Zod model, lazily creates and
  // caches the instrument by name, then routes the value to counter.add / histogram.record.
  return;
}
