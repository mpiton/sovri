// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "node:crypto";

import type { AuditTrailLogicalEvent } from "./schema.js";
import { createSigner } from "./signer.js";
import type { AuditTrailSink } from "./sink.js";
import { createFileAuditTrailWriter } from "./writer.js";

/** Options for an opt-in Community audit-trail file writer. */
export interface CommunityAuditTrailOptions {
  /** Absolute path of the JSONL file the trail is appended to. */
  readonly filePath: string;
  /**
   * Operator-provided Ed25519 private key (PKCS#8 PEM) giving the trail a stable identity across
   * runs. When omitted, an ephemeral key pair is generated per writer: the trail stays
   * tamper-evident and offline-verifiable, but carries no cross-run identity.
   */
  readonly privateKeyPem?: string;
}

/** A ready-to-inject sink plus the public key needed to verify the trail it produces. */
export interface CommunityAuditTrailWriter {
  readonly sink: AuditTrailSink;
  /** SPKI PEM of the signing key, also embedded in the `trail.started` genesis entry. */
  readonly publicKeyPem: string;
}

function resolveKeyPair(privateKeyPem: string | undefined): {
  privateKey: KeyObject;
  publicKeyPem: string;
} {
  if (privateKeyPem !== undefined) {
    const privateKey = createPrivateKey(privateKeyPem);
    const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
    return { privateKey, publicKeyPem: publicKeyPem.toString() };
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

/**
 * Build an opt-in, file-backed {@link AuditTrailSink} usable from the Community bot.
 *
 * The raw {@link createFileAuditTrailWriter}/{@link createSigner} stay internal (ADR-014): this
 * factory owns the key material and exposes only the sink plus its public key. It also closes the
 * gap that makes the foundation usable end-to-end — the review orchestrator emits `review.started`
 * first, but a valid chain must open with a `trail.started` genesis (the only entry allowed a null
 * `previous_hash`). The sink lazily prepends that genesis on the first append, so injecting it into
 * `reviewPullRequest` yields a trail that verifies offline with `verifyAuditTrail`.
 */
export function createCommunityAuditTrailWriter(
  options: CommunityAuditTrailOptions,
): CommunityAuditTrailWriter {
  const { privateKey, publicKeyPem } = resolveKeyPair(options.privateKeyPem);
  const inner = createFileAuditTrailWriter(options.filePath, createSigner(privateKey));
  const trailId = randomUUID();
  let started = false;

  const sink: AuditTrailSink = {
    async append(event: AuditTrailLogicalEvent): Promise<void> {
      if (!started) {
        // Flip `started` only after the genesis write resolves: if it throws, the next append
        // retries the genesis instead of writing a headless chain (the orchestrator's
        // emitAuditEvent swallows the error and keeps going, so the retry is reachable).
        await inner.append({
          ts: new Date().toISOString(),
          event: "trail.started",
          trail_id: trailId,
          public_key: publicKeyPem,
        });
        started = true;
      }
      await inner.append(event);
    },
  };

  return { sink, publicKeyPem };
}
