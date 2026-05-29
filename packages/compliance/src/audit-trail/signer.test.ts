// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash, generateKeyPairSync, verify, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import * as compliancePublicApi from "../index.js";
import type { AuditTrailLogicalEvent } from "./schema.js";
import { createSigner } from "./signer.js";

const TS = "2026-05-26T14:32:00Z";

// Stands in for the trail.started entry's hash; reused as the seed previous_hash for the
// interior entries so the chain fixtures line up with the task-95/96 canonical set.
const SEED_PREVIOUS_HASH =
  "sha256:1f0c8d9e2a7b4c6f5e3d2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d";

const trailStarted = {
  ts: "2026-05-26T14:31:55Z",
  event: "trail.started",
  trail_id: "trail-2026-05-26-pr42",
  public_key: "MCowBQYDK2VwAyEA...",
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

const findingCreated = {
  ts: TS,
  event: "finding.created",
  audit_reference: "SOVRI-AC-AB12-CD34",
  severity: "major",
  cwe: "CWE-798",
  compliance_references: ["GDPR-Art32", "DORA-Art9"],
} satisfies AuditTrailLogicalEvent;

// The documented canonical form (R-03): the logical event plus previous_hash, excluding
// only entry_hash and signature. The test re-derives it independently so a drift in the
// signer's canonicalisation is caught instead of mirrored.
function canonicalize(event: AuditTrailLogicalEvent, previousHash: string | null): string {
  return JSON.stringify({ ...event, previous_hash: previousHash });
}

// R-04: entry_hash = "sha256:" + sha256(canonical).
function expectedEntryHash(event: AuditTrailLogicalEvent, previousHash: string | null): string {
  return `sha256:${createHash("sha256").update(canonicalize(event, previousHash)).digest("hex")}`;
}

// R-05: the "ed25519:<base64url>" signature verifies against the public key over the
// entry_hash bytes (Ed25519 signs the message directly, hence the null algorithm).
function signatureVerifies(entryHash: string, signature: string, publicKey: KeyObject): boolean {
  const raw = Buffer.from(signature.replace(/^ed25519:/, ""), "base64url");
  return verify(null, Buffer.from(entryHash), publicKey, raw);
}

describe("Ed25519 signer — signing a logical event yields a verifiable signed entry (R-02, R-03, R-04, R-05, R-06)", () => {
  it("produces a signed entry whose hash and signature verify", () => {
    // Given an Ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    // And a signer created from the private key
    const signEntry = createSigner(privateKey);

    // And a "review.started" event
    // And the previous hash "sha256:1f0c…c1d"
    const previousHash = SEED_PREVIOUS_HASH;

    // When I sign the event with that previous hash
    const entry = signEntry(reviewStarted, previousHash);

    // Then the signed entry keeps every logical field of the event unchanged
    expect(entry).toMatchObject(reviewStarted);

    // And the signed entry carries previous_hash equal to that previous hash
    expect(entry.previous_hash).toBe(previousHash);

    // And entry_hash equals "sha256:" followed by the SHA-256 of the canonical JSON of the event plus previous_hash
    expect(entry.entry_hash).toBe(expectedEntryHash(reviewStarted, previousHash));

    // And signature equals "ed25519:" followed by the base64url of the Ed25519 signature over the entry_hash bytes
    expect(entry.signature.startsWith("ed25519:")).toBe(true);

    // And verifying the signature against the public key over the entry_hash succeeds
    expect(signatureVerifies(entry.entry_hash, entry.signature, publicKey)).toBe(true);
  });
});

describe("Ed25519 signer — the first entry embeds a null previous_hash in the canonical (R-03, R-04, R-05)", () => {
  it("signs trail.started with a null previous_hash", () => {
    // Given an Ed25519 key pair
    // And a signer created from the private key
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signEntry = createSigner(privateKey);

    // And a "trail.started" event
    // When I sign the event with a null previous hash
    const entry = signEntry(trailStarted, null);

    // Then the signed entry carries previous_hash null
    expect(entry.previous_hash).toBeNull();

    // And entry_hash equals "sha256:" followed by the SHA-256 of the canonical JSON of the event plus a literal null previous_hash
    expect(entry.entry_hash).toBe(expectedEntryHash(trailStarted, null));

    // And verifying the signature against the public key over the entry_hash succeeds
    expect(signatureVerifies(entry.entry_hash, entry.signature, publicKey)).toBe(true);
  });
});

describe("Ed25519 signer — tampering with a signed field is detectable (R-07)", () => {
  it("breaks both the recomputed hash and the signature when severity is altered", () => {
    // Given a signed "finding.created" entry over {…"severity":"major"…} with previous hash "sha256:1f0c…c1d"
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signEntry = createSigner(privateKey);
    const previousHash = SEED_PREVIOUS_HASH;
    const entry = signEntry(findingCreated, previousHash);

    // When an attacker changes severity from "major" to "info" in the stored entry
    const tamperedEvent = { ...findingCreated, severity: "info" } satisfies AuditTrailLogicalEvent;
    const honestHashOfTampered = expectedEntryHash(tamperedEvent, previousHash);

    // Then the SHA-256 recomputed over the tampered canonical no longer equals the stored entry_hash
    expect(honestHashOfTampered).not.toBe(entry.entry_hash);

    // And verifying the stored signature against the tampered content fails
    expect(signatureVerifies(honestHashOfTampered, entry.signature, publicKey)).toBe(false);
  });
});

describe("Ed25519 signer — deleting the middle entry of a 3-entry chain breaks the chain (R-07)", () => {
  it("leaves the third entry's previous_hash pointing at the removed entry, not its new predecessor", () => {
    // Given a signed chain of three entries built in order: trail.started, review.started, review.completed
    const { privateKey } = generateKeyPairSync("ed25519");
    const signEntry = createSigner(privateKey);

    const first = signEntry(trailStarted, null);
    const second = signEntry(reviewStarted, first.entry_hash);
    const third = signEntry(reviewCompleted, second.entry_hash);

    // When the second entry is removed, leaving the first and third entries
    // (the chain is now [first, third])

    // Then the third entry's previous_hash still equals the removed second entry's entry_hash
    expect(third.previous_hash).toBe(second.entry_hash);

    // But the third entry's previous_hash does not equal the first entry's entry_hash
    expect(third.previous_hash).not.toBe(first.entry_hash);

    // And the broken linkage between the first and third entries is detectable
    expect(third.previous_hash === first.entry_hash).toBe(false);
  });
});

describe("Ed25519 signer — signing the same event twice is deterministic (R-04, R-05)", () => {
  it("returns a byte-identical entry for identical input", () => {
    // Given an Ed25519 key pair
    // And a signer created from the private key
    const { privateKey } = generateKeyPairSync("ed25519");
    const signEntry = createSigner(privateKey);

    // And a "llm.called" event
    // And the previous hash "sha256:1f0c…c1d"
    const previousHash = SEED_PREVIOUS_HASH;

    // When I sign the event with that previous hash twice
    const first = signEntry(llmCalled, previousHash);
    const second = signEntry(llmCalled, previousHash);

    // Then both signed entries have the same entry_hash
    expect(first.entry_hash).toBe(second.entry_hash);

    // And both signed entries have the same signature
    expect(first.signature).toBe(second.signature);
  });
});

describe("Ed25519 signer — the signed entry conforms to SignedAuditTrailEntrySchema (R-02, R-03)", () => {
  const cases: ReadonlyArray<{ event: AuditTrailLogicalEvent; previousHash: string | null }> = [
    { event: trailStarted, previousHash: null },
    { event: reviewStarted, previousHash: SEED_PREVIOUS_HASH },
  ];

  it.each(cases)(
    "parses the signed $event.event entry without error",
    ({ event, previousHash }) => {
      // Given an Ed25519 key pair
      // And a signer created from the private key
      const { privateKey } = generateKeyPairSync("ed25519");
      const signEntry = createSigner(privateKey);

      // When I sign the event with previous hash <previous_hash>
      const entry = signEntry(event, previousHash);

      // Then SignedAuditTrailEntrySchema parses the signed entry without error
      expect(() => compliancePublicApi.SignedAuditTrailEntrySchema.parse(entry)).not.toThrow();
    },
  );
});

describe("Ed25519 signer — input is normalised so stale signing fields never enter the canonical (R-03)", () => {
  it("rejects an event that already carries entry_hash or signature fields", () => {
    // Given an Ed25519 key pair
    // And a signer created from the private key
    const { privateKey } = generateKeyPairSync("ed25519");
    const signEntry = createSigner(privateKey);

    // And an event still carrying signing fields (a SignedAuditTrailEntry is structurally
    // assignable to AuditTrailLogicalEvent; cast past the static type to feed the runtime guard)
    const taintedEvent: unknown = {
      ts: TS,
      event: "review.completed",
      entry_hash: "sha256:dead",
      signature: "ed25519:beef",
    };

    // When I sign that event, Then signing is rejected (the stale fields never reach the canonical)
    expect(() => signEntry(taintedEvent as AuditTrailLogicalEvent, SEED_PREVIOUS_HASH)).toThrow();
  });
});

describe("Ed25519 signer — createSigner is not part of the public package surface (R-08)", () => {
  it("is absent from the @sovri/compliance entrypoint and reachable only via the internal module", () => {
    // Given the @sovri/compliance public entrypoint at src/index.ts
    // Then it does not export "createSigner"
    expect("createSigner" in compliancePublicApi).toBe(false);

    // And createSigner is importable only from the internal module "./audit-trail/signer.js"
    expect(typeof createSigner).toBe("function");
  });
});
