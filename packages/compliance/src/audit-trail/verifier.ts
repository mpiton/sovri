// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createHash, verify, type KeyObject } from "node:crypto";

import type { SignedAuditTrailEntry } from "./schema.js";

const ED25519_SIGNATURE_LENGTH_BYTES = 64;
const ED25519_SIGNATURE_PATTERN = /^ed25519:([A-Za-z0-9_-]+)$/u;

/** The fixed reasons a verification can fail, in the order the per-entry checks run. */
type VerificationFailureReason =
  | "previous_hash mismatch"
  | "entry_hash mismatch"
  | "signature invalid";

/**
 * Outcome of an offline audit-trail verification. A success carries only `valid: true`; a failure
 * carries the 0-based `failAt` index of the first failing entry and one fixed `reason`. The two
 * shapes are a discriminated union, so a `valid` check narrows away the absent fields — there is
 * no `valid: true` that also has a `reason`, and no `valid: false` missing its `failAt`.
 */
export type VerifyResult =
  | { valid: true }
  | { valid: false; failAt: number; reason: VerificationFailureReason };

// The canonical bytes the signer hashed: the entry minus its crypto fields, with `previous_hash`
// and every logical field kept in their original order (R-03 — only `entry_hash` + `signature`
// are excluded). The clone is typed as a plain record so removing the two fields needs no
// rest-destructure over the entry union; spread + delete preserve the original key order.
function canonicalize(entry: SignedAuditTrailEntry): string {
  const withoutCryptoFields: Record<string, unknown> = { ...entry };
  delete withoutCryptoFields.entry_hash;
  delete withoutCryptoFields.signature;
  return JSON.stringify(withoutCryptoFields);
}

function decodeCanonicalSignature(signature: string): Buffer | undefined {
  const encoded = ED25519_SIGNATURE_PATTERN.exec(signature)?.[1];
  if (encoded === undefined) {
    return undefined;
  }

  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== ED25519_SIGNATURE_LENGTH_BYTES) {
    return undefined;
  }

  return decoded.toString("base64url") === encoded ? decoded : undefined;
}

/**
 * Verify a signed audit trail offline: hash chain + Ed25519 signatures, no I/O.
 *
 * Each entry is checked in a fixed order, returning at the first failure so an auditor gets a
 * precise `(failAt, reason)`:
 *  1. chain — the first entry anchors to a null `previous_hash`, every later entry chains to its
 *     predecessor's `entry_hash`;
 *  2. `entry_hash` — recomputed as `sha256:` + SHA-256 of the canonical (matching the signer);
 *  3. `signature` — the Ed25519 signature verifies against `publicKey` over the `entry_hash` bytes.
 *
 * An empty trail is vacuously valid. The verifier holds no state and reads no file or socket; the
 * caller passes an already-parsed `SignedAuditTrailEntry[]` and the trail's public key.
 */
export function verifyAuditTrail(
  entries: readonly SignedAuditTrailEntry[],
  publicKey: KeyObject,
): VerifyResult {
  let previousHash: string | null = null;
  let index = 0;

  for (const entry of entries) {
    if (entry.previous_hash !== previousHash) {
      return { valid: false, failAt: index, reason: "previous_hash mismatch" };
    }

    const computed: string = `sha256:${createHash("sha256").update(canonicalize(entry)).digest("hex")}`;
    if (entry.entry_hash !== computed) {
      return { valid: false, failAt: index, reason: "entry_hash mismatch" };
    }

    const signatureBytes = decodeCanonicalSignature(entry.signature);
    if (signatureBytes === undefined) {
      return { valid: false, failAt: index, reason: "signature invalid" };
    }

    if (!verify(null, Buffer.from(entry.entry_hash), publicKey, signatureBytes)) {
      return { valid: false, failAt: index, reason: "signature invalid" };
    }

    previousHash = entry.entry_hash;
    index++;
  }

  return { valid: true };
}
