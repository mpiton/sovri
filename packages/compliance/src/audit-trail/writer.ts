// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { appendFile } from "node:fs/promises";

import type { AuditTrailLogicalEvent } from "./schema.js";
import type { createSigner } from "./signer.js";
import type { AuditTrailSink } from "./sink.js";

/**
 * Build a file-backed {@link AuditTrailSink} that signs every logical event and appends it as one
 * JSONL line to `filePath`.
 *
 * Each `append` signs the unsigned event through the injected `signer`, chaining it to the prior
 * entry's hash, and writes `JSON.stringify(entry) + "\n"` in append mode (`'a'`), so entries
 * already on disk are never rewritten. The chain head (`previousHash`) lives in the closure: null
 * for the first entry, advanced only after a write succeeds — a failed write propagates to the
 * caller and leaves the chain un-advanced, so a later append still chains from the last good entry.
 *
 * Appends must be serialised (await each before the next): the closure `previousHash` is read at
 * the start of `append`, so overlapping calls would chain onto a stale head. The orchestrator emits
 * events sequentially, which satisfies this.
 *
 * Internal in v0.3 — not re-exported from the package entrypoint; the Cloud writer owns key
 * material and is the only caller. See ADR-014.
 */
export function createFileAuditTrailWriter(
  filePath: string,
  signer: ReturnType<typeof createSigner>,
): AuditTrailSink {
  let previousHash: string | null = null;
  return {
    async append(event: AuditTrailLogicalEvent): Promise<void> {
      const signed = signer(event, previousHash);
      await appendFile(filePath, `${JSON.stringify(signed)}\n`, "utf-8");
      previousHash = signed.entry_hash;
    },
  };
}
