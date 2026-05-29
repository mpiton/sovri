// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import type { KeyObject } from "node:crypto";

import type { SignedAuditTrailEntry } from "./schema.js";

/**
 * Outcome of an offline audit-trail verification. `valid` is the only field on success; on the
 * first failing entry the verifier adds `failAt` (its 0-based index) and a fixed `reason`.
 */
export interface VerifyResult {
  valid: boolean;
  failAt?: number;
  reason?: string;
}

/**
 * RED stub — implemented in green-cycle. Throws so every acceptance scenario fails loudly for the
 * expected reason (missing implementation) while the test still type-checks under `tsc -b`.
 */
export function verifyAuditTrail(
  _entries: readonly SignedAuditTrailEntry[],
  _publicKey: KeyObject,
): VerifyResult {
  throw new Error("verifyAuditTrail: not implemented");
}
