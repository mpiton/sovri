// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { AuditTrailLogicalEventSchema, type AuditTrailLogicalEvent } from "./schema.js";

/**
 * Orchestrator-facing port for emitting unsigned audit-trail events. The chain and the
 * Ed25519 signature belong to the file writer, never to a sink: a sink only ever holds
 * {@link AuditTrailLogicalEvent}s.
 */
export interface AuditTrailSink {
  append(event: AuditTrailLogicalEvent): Promise<void>;
}

/**
 * In-memory {@link AuditTrailSink} backing orchestrator tests. Stores unsigned logical
 * events in insertion order and never signs.
 */
export class MemoryAuditTrailSink implements AuditTrailSink {
  readonly #events: AuditTrailLogicalEvent[] = [];

  // `async` so a validation failure surfaces as a rejected promise, honoring the port's
  // `Promise<void>` contract. Re-validate at the boundary: a malformed event never enters
  // the trail (the throw happens before the push).
  async append(event: AuditTrailLogicalEvent): Promise<void> {
    this.#events.push(AuditTrailLogicalEventSchema.parse(event));
  }

  // Defensive copy: mutating the returned array cannot corrupt the stored trail.
  getEvents(): readonly AuditTrailLogicalEvent[] {
    return [...this.#events];
  }
}
