// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { describe, expect, it } from "vitest";

import {
  type AuditTrailLogicalEvent,
  type AuditTrailSink,
  MemoryAuditTrailSink,
} from "../index.js";

const TS = "2026-05-26T14:32:00Z";

// Concrete logical events reused from the task-95 canonical set.
const findingCreated = {
  ts: TS,
  event: "finding.created",
  audit_reference: "SOVRI-AC-AB12-CD34",
  severity: "major",
  cwe: "CWE-798",
  compliance_references: ["GDPR-Art32", "DORA-Art9"],
} satisfies AuditTrailLogicalEvent;

const reviewStarted = {
  ts: TS,
  event: "review.started",
  pr_id: 42,
  commit_sha: "1234567890abcdef1234567890abcdef12345678",
  llm_provider: "mistral",
  llm_model: "mistral-large-2-2411",
} satisfies AuditTrailLogicalEvent;

const llmCalled = {
  ts: "2026-05-26T14:32:05Z",
  event: "llm.called",
  prompt_hash: "sha256:7f3a",
  tokens_in: 4521,
  tokens_out: 892,
} satisfies AuditTrailLogicalEvent;

const reviewCompleted = {
  ts: "2026-05-26T14:32:10Z",
  event: "review.completed",
} satisfies AuditTrailLogicalEvent;

describe("MemoryAuditTrailSink — append stores unsigned logical events (R-01, R-02, R-04)", () => {
  it("stores an appended logical event unsigned", async () => {
    // Given a new MemoryAuditTrailSink
    const sink = new MemoryAuditTrailSink();

    // When I append a logical event with ts "2026-05-26T14:32:00Z" and event "finding.created"
    // And the payload {"audit_reference":"SOVRI-AC-AB12-CD34","severity":"major",...}
    await sink.append(findingCreated);

    // Then append resolves
    // And getEvents returns 1 event
    const events = sink.getEvents();
    expect(events).toHaveLength(1);

    // And the stored event has no "previous_hash", "entry_hash" or "signature" field
    const [stored] = events;
    expect(stored).not.toHaveProperty("previous_hash");
    expect(stored).not.toHaveProperty("entry_hash");
    expect(stored).not.toHaveProperty("signature");
  });
});

describe("MemoryAuditTrailSink — getEvents preserves insertion order (R-03)", () => {
  it("returns appended events in the order they were appended", async () => {
    // Given a new MemoryAuditTrailSink
    const sink = new MemoryAuditTrailSink();

    // When I append the following logical events in order: review.started, llm.called, review.completed
    await sink.append(reviewStarted);
    await sink.append(llmCalled);
    await sink.append(reviewCompleted);

    // Then getEvents returns 3 events
    const events = sink.getEvents();
    expect(events).toHaveLength(3);

    // And the events appear in the same order they were appended
    expect(events.map((event) => event.event)).toEqual([
      "review.started",
      "llm.called",
      "review.completed",
    ]);
  });

  it("returns no events for a new sink", () => {
    // Given a new MemoryAuditTrailSink
    const sink = new MemoryAuditTrailSink();

    // Then getEvents returns 0 events
    expect(sink.getEvents()).toHaveLength(0);
  });

  it("returns a defensive copy isolated from internal state", async () => {
    // Given a MemoryAuditTrailSink with 1 appended event
    const sink = new MemoryAuditTrailSink();
    await sink.append(findingCreated);

    // When the caller mutates the array returned by getEvents
    // The readonly contract is compile-time only; cast to simulate a hostile caller mutating the result.
    (sink.getEvents() as AuditTrailLogicalEvent[]).push(reviewStarted);

    // Then a subsequent getEvents still returns 1 event
    expect(sink.getEvents()).toHaveLength(1);
  });

  it("returns events that do not alias the stored trail", async () => {
    // Given a MemoryAuditTrailSink with 1 appended event
    const sink = new MemoryAuditTrailSink();
    await sink.append(findingCreated);

    // When the caller mutates a field of a returned event
    // (cast past readonly to simulate a hostile caller mutating a returned event object)
    const [returned] = sink.getEvents() as AuditTrailLogicalEvent[];
    if (returned?.event === "finding.created") {
      returned.compliance_references.push("INJECTED");
    }

    // Then a subsequent getEvents still returns the event unchanged
    expect(sink.getEvents()).toEqual([findingCreated]);
  });
});

describe("MemoryAuditTrailSink — append runtime-validates and stores nothing on rejection (R-01, R-02, R-04)", () => {
  it("rejects an event that carries signing fields", async () => {
    // Given a new MemoryAuditTrailSink
    const sink = new MemoryAuditTrailSink();

    // When I append an event with ts "2026-05-26T14:32:00Z" and event "review.completed"
    // And the extra signing fields {"previous_hash":"sha256:1111","entry_hash":"sha256:2222","signature":"ed25519:zzzz"}
    // A signed entry is not a logical event; cast past the static type to exercise the runtime guard.
    const withSigningFields: unknown = {
      ts: TS,
      event: "review.completed",
      previous_hash: "sha256:1111",
      entry_hash: "sha256:2222",
      signature: "ed25519:zzzz",
    };

    // Then append is rejected
    await expect(sink.append(withSigningFields as AuditTrailLogicalEvent)).rejects.toThrow();

    // And getEvents returns 0 events
    expect(sink.getEvents()).toHaveLength(0);
  });

  const malformedEvents: ReadonlyArray<{ why: string; raw: unknown }> = [
    { why: "missing ts", raw: { event: "review.completed" } },
    {
      why: "ts is not an ISO-8601 datetime",
      raw: { ts: "not-a-datetime", event: "review.completed" },
    },
    {
      why: "review.started missing required keys",
      raw: { ts: TS, event: "review.started", pr_id: 42 },
    },
    { why: "unknown discriminator", raw: { ts: TS, event: "unknown.event" } },
  ];

  it.each(malformedEvents)(
    "rejects a malformed event ($why) and stores nothing",
    async ({ raw }) => {
      // Given a new MemoryAuditTrailSink
      const sink = new MemoryAuditTrailSink();

      // When I append the raw event <raw_event>
      // Feed malformed runtime input past the static type to exercise append's validation.
      // Then append is rejected
      await expect(sink.append(raw as AuditTrailLogicalEvent)).rejects.toThrow();

      // And getEvents returns 0 events
      expect(sink.getEvents()).toHaveLength(0);
    },
  );
});

describe("public exports from @sovri/compliance (R-06)", () => {
  it("publishes MemoryAuditTrailSink from the package entry point", () => {
    // Given the @sovri/compliance public entrypoint
    // Then it exports the value "MemoryAuditTrailSink"
    expect(typeof MemoryAuditTrailSink).toBe("function");
  });

  it("publishes the AuditTrailSink port, implemented by MemoryAuditTrailSink", () => {
    // And it exports the type "AuditTrailSink"
    const sink: AuditTrailSink = new MemoryAuditTrailSink();
    expect(sink).toBeInstanceOf(MemoryAuditTrailSink);
  });
});
