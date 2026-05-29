// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash, sign, type KeyObject } from "node:crypto";

import {
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "./schema.js";

/**
 * Build an Ed25519 audit-trail signer bound to one private key.
 *
 * The returned function turns a logical event plus its predecessor's hash into a signed,
 * chained entry. The signed content is the canonical JSON of the event together with its
 * `previous_hash` (only `entry_hash` and `signature` are excluded), so deletion or
 * reordering of entries breaks the chain and is detectable offline.
 *
 * Internal in v0.3 — not re-exported from the package entrypoint; the Cloud writer owns key
 * material and is the only caller. See ADR-014.
 */
export function createSigner(privateKey: KeyObject) {
  return (event: AuditTrailLogicalEvent, previousHash: string | null): SignedAuditTrailEntry => {
    // Normalise the input to a pure logical event before hashing. A value typed as
    // AuditTrailLogicalEvent can still carry excess `entry_hash` / `signature` fields at
    // runtime (a SignedAuditTrailEntry is structurally assignable to it), and the spread
    // would otherwise fold those stale fields into the canonical bytes — a verifier excludes
    // them, so the freshly signed entry would fail verification. strictObject rejects such
    // input loudly, exactly as the sink does, keeping the canonical strictly the logical
    // event plus `previous_hash`.
    const logical = AuditTrailLogicalEventSchema.parse(event);
    const canonical = JSON.stringify({ ...logical, previous_hash: previousHash });
    const entryHash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    const signature = `ed25519:${sign(null, Buffer.from(entryHash), privateKey).toString("base64url")}`;
    // Re-parse the assembled entry: it both yields the precise discriminated-union type
    // (TypeScript cannot narrow it through the spread) and enforces the chain invariant at
    // signing time — e.g. a `trail.started` entry must carry a null `previous_hash`.
    return SignedAuditTrailEntrySchema.parse({
      ...logical,
      previous_hash: previousHash,
      entry_hash: entryHash,
      signature,
    });
  };
}
