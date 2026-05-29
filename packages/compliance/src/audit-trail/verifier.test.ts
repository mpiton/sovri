// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as compliancePublicApi from "../index.js";
import type { AuditTrailLogicalEvent, SignedAuditTrailEntry } from "./schema.js";
import { createSigner } from "./signer.js";
import { verifyAuditTrail } from "./verifier.js";

// ---------------------------------------------------------------------------
// Background — the standard valid 5-event review lifecycle from verifier.feature.
// Concrete data matches the feature's Background table verbatim.
// ---------------------------------------------------------------------------
const trailStarted = {
  ts: "2026-05-26T14:31:55Z",
  event: "trail.started",
  trail_id: "trail-2026-05-26-pr42",
  public_key: "MCowBQYDK2VwAyEApZ4f8Q9sZ0sample0base64",
} satisfies AuditTrailLogicalEvent;

const reviewStarted = {
  ts: "2026-05-26T14:31:56Z",
  event: "review.started",
  pr_id: 42,
  commit_sha: "3f2a9c1b7d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1a",
  llm_provider: "anthropic",
  llm_model: "claude-opus-4-8",
} satisfies AuditTrailLogicalEvent;

const llmCalled = {
  ts: "2026-05-26T14:31:57Z",
  event: "llm.called",
  prompt_hash: "sha256:ab12cd34ef56",
  tokens_in: 1500,
  tokens_out: 320,
} satisfies AuditTrailLogicalEvent;

const findingCreated = {
  ts: "2026-05-26T14:31:58Z",
  event: "finding.created",
  audit_reference: "SOVRI-SQ-1A2B-3C4D",
  severity: "blocker",
  cwe: "CWE-89",
  compliance_references: ["GDPR-32"],
} satisfies AuditTrailLogicalEvent;

const reviewCompleted = {
  ts: "2026-05-26T14:31:59Z",
  event: "review.completed",
} satisfies AuditTrailLogicalEvent;

// Sign the 5 events in chain order with the real signer (task-97). Fidelity rule: entries are
// produced by createSigner, never hand-built, so the verifier truly exercises the signer's
// canonicalisation rather than a copy of it.
function signedTrail(signEntry: ReturnType<typeof createSigner>) {
  const started = signEntry(trailStarted, null);
  const review = signEntry(reviewStarted, started.entry_hash);
  const llm = signEntry(llmCalled, review.entry_hash);
  const finding = signEntry(findingCreated, llm.entry_hash);
  const completed = signEntry(reviewCompleted, finding.entry_hash);
  return {
    started,
    review,
    llm,
    finding,
    completed,
    all: [started, review, llm, finding, completed],
  };
}

// A tampered fixture models raw JSONL an attacker edited on disk: the bytes still have the SHAPE
// of a SignedAuditTrailEntry (a field VALUE changed, not its type), but the signed invariants no
// longer hold. JSONL read back from a file is untyped anyway, so the cast reflects the verifier's
// real input; verifyAuditTrail must reject the tampered entry at runtime.
function withPatch(
  entries: readonly SignedAuditTrailEntry[],
  index: number,
  patch: Record<string, unknown>,
): SignedAuditTrailEntry[] {
  return entries.map((entry, i) =>
    i === index ? ({ ...entry, ...patch } as SignedAuditTrailEntry) : entry,
  );
}

describe("Offline audit-trail verification — a pristine trail verifies as valid (R-01, R-04, R-05, R-06)", () => {
  it("returns { valid: true } with no failAt and no reason", () => {
    // Given the signed 5-entry trail from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When I verify the trail against the public key
    const result = verifyAuditTrail(trail.all, publicKey);

    // Then the result is { valid: true } (and carries no failAt and no reason)
    expect(result).toEqual({ valid: true });
  });
});

describe("Offline audit-trail verification — a tampered logical field is caught by the entry_hash check before the signature check (R-03, R-04, R-07)", () => {
  const cases: ReadonlyArray<{ index: number; field: string; from: unknown; to: unknown }> = [
    { index: 2, field: "tokens_out", from: 320, to: 999 },
    { index: 3, field: "severity", from: "blocker", to: "minor" },
  ];

  it.each(cases)(
    "reports entry_hash mismatch at index $index when $field changes from $from to $to",
    ({ index, field, to }) => {
      // Given the signed 5-entry trail from the background
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const trail = signedTrail(createSigner(privateKey));

      // When the <field> field of entry <index> is changed after signing
      const tampered = withPatch(trail.all, index, { [field]: to });

      // And I verify the tampered trail against the public key
      const result = verifyAuditTrail(tampered, publicKey);

      // Then the result is { valid: false } with failAt <index> and reason "entry_hash mismatch"
      // (the entry_hash check is reported rather than the signature check, which is also now wrong)
      expect(result).toEqual({ valid: false, failAt: index, reason: "entry_hash mismatch" });
    },
  );
});

describe("Offline audit-trail verification — a deleted middle entry is caught by the hash-chain link check (R-05, R-07)", () => {
  it("reports previous_hash mismatch at the index the deletion shifted forward", () => {
    // Given the signed 5-entry trail from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When entry 2 (llm.called) is removed, leaving 4 entries in their original order
    const shortened = trail.all.filter((_entry, i) => i !== 2);

    // And I verify the shortened trail against the public key
    const result = verifyAuditTrail(shortened, publicKey);

    // Then the result is { valid: false } with failAt 2 and reason "previous_hash mismatch"
    expect(result).toEqual({ valid: false, failAt: 2, reason: "previous_hash mismatch" });
  });
});

describe("Offline audit-trail verification — a head-truncated trail is caught by the first-entry null anchor (R-05, R-07)", () => {
  it("reports previous_hash mismatch at index 0 when trail.started is removed", () => {
    // Given the signed 5-entry trail from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When entry 0 (trail.started) is removed, so review.started becomes the first entry
    const truncated = trail.all.slice(1);

    // And I verify the truncated trail against the public key
    const result = verifyAuditTrail(truncated, publicKey);

    // Then the result is { valid: false } with failAt 0 and reason "previous_hash mismatch"
    expect(result).toEqual({ valid: false, failAt: 0, reason: "previous_hash mismatch" });
  });
});

describe("Offline audit-trail verification — a trail verified against a different public key fails on the signature (R-06, R-07)", () => {
  it("reports signature invalid at index 0 under the wrong public key", () => {
    // Given the signed 5-entry trail from the background
    const { privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // And a second, unrelated Ed25519 key pair
    const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");

    // When I verify the trail against the second key pair's public key
    const result = verifyAuditTrail(trail.all, otherPublicKey);

    // Then the result is { valid: false } with failAt 0 and reason "signature invalid"
    expect(result).toEqual({ valid: false, failAt: 0, reason: "signature invalid" });
  });
});

describe("Offline audit-trail verification — a corrupted signature on one entry fails only that entry (R-06, R-07)", () => {
  it("reports signature invalid at index 3 when its signature is replaced", () => {
    // Given the signed 5-entry trail from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When the signature of entry 3 (finding.created) is corrupted after signing
    // (replaced with entry 0's signature: a real Ed25519 signature over the wrong entry_hash)
    const tampered = withPatch(trail.all, 3, { signature: trail.started.signature });

    // And I verify the trail against the matching public key
    const result = verifyAuditTrail(tampered, publicKey);

    // Then the result is { valid: false } with failAt 3 and reason "signature invalid"
    expect(result).toEqual({ valid: false, failAt: 3, reason: "signature invalid" });
  });
});

describe("Offline audit-trail verification — when an entry fails several checks at once the chain check wins (R-05, R-04, R-07)", () => {
  it("reports previous_hash mismatch, not entry_hash mismatch, when both break at index 2", () => {
    // Given the signed 5-entry trail from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When entry 2's previous_hash is overwritten with a bogus hash and its tokens_out is also changed
    const tampered = withPatch(trail.all, 2, {
      previous_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      tokens_out: 999,
    });

    // And I verify the trail against the public key
    const result = verifyAuditTrail(tampered, publicKey);

    // Then the result is { valid: false } with failAt 2 and reason "previous_hash mismatch"
    expect(result).toEqual({ valid: false, failAt: 2, reason: "previous_hash mismatch" });
  });
});

describe("Offline audit-trail verification — an empty trail is vacuously valid (R-08)", () => {
  it("returns { valid: true } for an empty list of entries", () => {
    // Given an empty list of entries
    const { publicKey } = generateKeyPairSync("ed25519");

    // When I verify it against any Ed25519 public key
    const result = verifyAuditTrail([], publicKey);

    // Then the result is { valid: true } (and carries no failAt and no reason)
    expect(result).toEqual({ valid: true });
  });
});

describe("Offline audit-trail verification — a single-entry trail verifies as valid (R-05, R-08)", () => {
  it("returns { valid: true } for a trail of only the trail.started entry", () => {
    // Given a signed trail of only the trail.started entry from the background
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const trail = signedTrail(createSigner(privateKey));

    // When I verify the single-entry trail against the public key
    const result = verifyAuditTrail([trail.started], publicKey);

    // Then the result is { valid: true } (and carries no failAt and no reason)
    expect(result).toEqual({ valid: true });
  });
});

describe("Offline audit-trail verification — verifyAuditTrail and VerifyResult are part of the public package surface (R-09, R-02)", () => {
  it("exports the function and type from the entrypoint and ships no CLI", () => {
    // Given the @sovri/compliance public entrypoint at src/index.ts
    // Then it exports "verifyAuditTrail"
    expect("verifyAuditTrail" in compliancePublicApi).toBe(true);

    // And it exports the type "VerifyResult" (re-exported from the verifier module)
    const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(indexSource).toContain("verifyAuditTrail");
    expect(indexSource).toContain("VerifyResult");
    expect(indexSource).toContain("./audit-trail/verifier.js");

    // And no CLI entry point ships for the verifier in v0.3
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { bin?: unknown };
    expect(pkg.bin).toBeUndefined();
  });
});
