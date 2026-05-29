// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { generateKeyPairSync, randomUUID, verify, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as compliancePublicApi from "../index.js";
import {
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "./schema.js";
import { createSigner } from "./signer.js";
import { createFileAuditTrailWriter } from "./writer.js";

// Concrete logical events. The trail.started payload mirrors writer.feature's nominal scenario
// verbatim; the interior events reuse the task-95/96/97 canonical set so fixtures line up suite-wide.
const trailStarted = {
  ts: "2026-05-26T14:31:55Z",
  event: "trail.started",
  trail_id: "trail-2026-05-26-pr42",
  public_key: "MCowBQYDK2VwAyEApZ4f8Q9sZ0sample0base64",
} satisfies AuditTrailLogicalEvent;

const reviewStarted = {
  ts: "2026-05-26T14:32:00Z",
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

const findingCreated = {
  ts: "2026-05-26T14:32:08Z",
  event: "finding.created",
  audit_reference: "SOVRI-AC-AB12-CD34",
  severity: "major",
  cwe: "CWE-798",
  compliance_references: ["GDPR-Art32", "DORA-Art9"],
} satisfies AuditTrailLogicalEvent;

const reviewCompleted = {
  ts: "2026-05-26T14:32:10Z",
  event: "review.completed",
} satisfies AuditTrailLogicalEvent;

// One JSONL line per non-empty segment. The trailing "\n" the writer appends yields a final
// empty segment, dropped here so a line count reflects entries, not the terminator.
function splitLines(content: string): string[] {
  return content.split("\n").filter((line) => line.length > 0);
}

// Reads the trail back through the public schema: a line that is not a SignedAuditTrailEntry
// throws here, so "each line parses as a SignedAuditTrailEntry" is encoded in the read itself.
async function readEntries(filePath: string): Promise<SignedAuditTrailEntry[]> {
  const content = await readFile(filePath, "utf-8");
  return splitLines(content).map((line) => SignedAuditTrailEntrySchema.parse(JSON.parse(line)));
}

// noUncheckedIndexedAccess-safe accessor: throws loudly rather than returning undefined, so an
// index assertion never silently passes on a short trail.
function entryAt(entries: readonly SignedAuditTrailEntry[], index: number): SignedAuditTrailEntry {
  const entry = entries[index];
  if (entry === undefined) {
    throw new Error(`expected a signed entry at index ${index}, found none`);
  }
  return entry;
}

// Ed25519 verifies the message bytes directly (null algorithm); the signature is base64url after
// the "ed25519:" tag, taken over the entry_hash bytes.
function signatureVerifies(entryHash: string, signature: string, publicKey: KeyObject): boolean {
  const raw = Buffer.from(signature.replace(/^ed25519:/, ""), "base64url");
  return verify(null, Buffer.from(entryHash), publicKey, raw);
}

let workDir: string;

beforeEach(async () => {
  workDir = join(tmpdir(), `sovri-audit-writer-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function freshTempFile(): string {
  return join(workDir, `${randomUUID()}.jsonl`);
}

describe("File-backed audit-trail writer — signs an unsigned logical event and writes its signed JSONL form (R-01, R-02, R-03)", () => {
  it("writes one signed line whose fields, hash and signature are the signer's output", async () => {
    // Given an Ed25519 key pair
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    // And a signer created from the private key
    const signer = createSigner(privateKey);

    // And a fresh temporary file path
    const filePath = freshTempFile();

    // And a file audit-trail writer created on that path with that signer
    const writer = createFileAuditTrailWriter(filePath, signer);

    // And an unsigned "trail.started" event with payload {"ts":"2026-05-26T14:31:55Z","trail_id":"trail-2026-05-26-pr42","public_key":"MCowBQYDK2VwAyEApZ4f8Q9sZ0sample0base64"}
    // When the sink appends the unsigned event
    await writer.append(trailStarted);

    // Then the file contains exactly one line
    const entries = await readEntries(filePath);
    expect(entries).toHaveLength(1);

    // And that line parses as a SignedAuditTrailEntry  (enforced by readEntries via the schema)
    const entry = entryAt(entries, 0);

    // And the parsed entry keeps every logical field of the unsigned event unchanged
    expect(entry).toMatchObject(trailStarted);

    // And the parsed entry carries an entry_hash and a signature produced by the signer
    const expected = signer(trailStarted, null);
    expect(entry.entry_hash).toBe(expected.entry_hash);
    expect(entry.signature).toBe(expected.signature);

    // And the parsed entry's previous_hash is null
    expect(entry.previous_hash).toBeNull();

    // And verifying the signature against the public key over the entry_hash succeeds
    expect(signatureVerifies(entry.entry_hash, entry.signature, publicKey)).toBe(true);
  });
});

describe("File-backed audit-trail writer — each appended line chains to the previous entry's hash (R-03, R-05)", () => {
  it("links each line's previous_hash to the prior line's entry_hash, the first carrying null", async () => {
    // Given a file audit-trail writer on a fresh temporary file
    const { privateKey } = generateKeyPairSync("ed25519");
    const filePath = freshTempFile();
    const writer = createFileAuditTrailWriter(filePath, createSigner(privateKey));

    // When the sink appends, in order, a "trail.started", then a "review.started", then a "review.completed" event
    await writer.append(trailStarted);
    await writer.append(reviewStarted);
    await writer.append(reviewCompleted);

    // Then the file contains 3 lines, each parseable as a SignedAuditTrailEntry
    const entries = await readEntries(filePath);
    expect(entries).toHaveLength(3);

    // And line 1 carries previous_hash null
    expect(entryAt(entries, 0).previous_hash).toBeNull();

    // And line 2's previous_hash equals line 1's entry_hash
    expect(entryAt(entries, 1).previous_hash).toBe(entryAt(entries, 0).entry_hash);

    // And line 3's previous_hash equals line 2's entry_hash
    expect(entryAt(entries, 2).previous_hash).toBe(entryAt(entries, 1).entry_hash);
  });
});

describe("File-backed audit-trail writer — five events appended in two batches produce a five-line file (R-03, R-04, R-05)", () => {
  it("appends 3 then 2 events into a 5-line file with an unbroken chain", async () => {
    // Given a file audit-trail writer on a fresh temporary file
    const { privateKey } = generateKeyPairSync("ed25519");
    const filePath = freshTempFile();
    const writer = createFileAuditTrailWriter(filePath, createSigner(privateKey));

    // When the sink appends a first batch of 3 events in order: "trail.started", "review.started", "llm.called"
    // (appends are awaited one by one on purpose: each call advances the closure previousHash that
    // the next entry chains onto, so Promise.all would race the chain.)
    await writer.append(trailStarted);
    await writer.append(reviewStarted);
    await writer.append(llmCalled);

    // And the sink appends a second batch of 2 events in order: "finding.created", "review.completed"
    await writer.append(findingCreated);
    await writer.append(reviewCompleted);

    // Then the file contains exactly 5 lines
    // And every line parses as a SignedAuditTrailEntry  (enforced by readEntries via the schema)
    const entries = await readEntries(filePath);
    expect(entries).toHaveLength(5);

    // And the previous_hash chain is unbroken across all 5 lines
    expect(entryAt(entries, 0).previous_hash).toBeNull();
    for (let index = 1; index < entries.length; index += 1) {
      expect(entryAt(entries, index).previous_hash).toBe(entryAt(entries, index - 1).entry_hash);
    }
  });
});

describe("File-backed audit-trail writer — re-opening the file with a new writer appends without truncating (R-04)", () => {
  it("keeps the earlier writer's lines byte-for-byte and only appends", async () => {
    // Given a file audit-trail writer wrote a "trail.started" then a "review.started" event to a temporary file
    const filePath = freshTempFile();
    const firstWriter = createFileAuditTrailWriter(
      filePath,
      createSigner(generateKeyPairSync("ed25519").privateKey),
    );
    await firstWriter.append(trailStarted);
    await firstWriter.append(reviewStarted);

    // And the file therefore contains 2 lines
    const before = await readFile(filePath, "utf-8");
    expect(splitLines(before)).toHaveLength(2);

    // When a new file audit-trail writer is created on the same path with a fresh signer
    const secondWriter = createFileAuditTrailWriter(
      filePath,
      createSigner(generateKeyPairSync("ed25519").privateKey),
    );

    // And the new writer appends a "trail.started" event
    await secondWriter.append(trailStarted);

    // Then the original 2 lines are still present and byte-for-byte unchanged
    const after = await readFile(filePath, "utf-8");
    expect(after.startsWith(before)).toBe(true);

    // And the file now contains 3 lines
    expect(splitLines(after)).toHaveLength(3);
  });
});

describe("File-backed audit-trail writer — a failed write propagates the error and never advances the chain (R-06)", () => {
  it("rejects on a missing directory, writes nothing, then chains from the un-advanced state on retry", async () => {
    // Given an Ed25519 key pair
    // And a signer created from the private key
    const { privateKey } = generateKeyPairSync("ed25519");
    const signer = createSigner(privateKey);

    // And a file audit-trail writer targeting a path whose parent directory does not exist
    const missingDir = join(workDir, "missing-subdir");
    const filePath = join(missingDir, "audit-trail.jsonl");
    const writer = createFileAuditTrailWriter(filePath, signer);

    // And an unsigned "trail.started" event with payload {"ts":"2026-05-26T14:31:55Z","trail_id":"trail-2026-05-26-pr42","public_key":"MCowBQYDK2VwAyEApZ4f8Q9sZ0sample0base64"}
    // When the sink appends the event
    // Then append rejects with the underlying filesystem error
    await expect(writer.append(trailStarted)).rejects.toThrow();

    // And no file exists at that path
    expect(existsSync(filePath)).toBe(false);

    // When the parent directory is created
    await mkdir(missingDir, { recursive: true });

    // And the sink appends the same event again
    await writer.append(trailStarted);

    // Then the file contains exactly one line
    const entries = await readEntries(filePath);
    expect(entries).toHaveLength(1);

    // And that line's previous_hash is null
    expect(entryAt(entries, 0).previous_hash).toBeNull();
  });
});

describe("File-backed audit-trail writer — createFileAuditTrailWriter is not part of the public package surface (R-07)", () => {
  it("is absent from the @sovri/compliance entrypoint and reachable only via the internal module", () => {
    // Given the @sovri/compliance public entrypoint at src/index.ts
    // Then it does not export "createFileAuditTrailWriter"
    expect("createFileAuditTrailWriter" in compliancePublicApi).toBe(false);

    // And createFileAuditTrailWriter is importable only from the internal module "./audit-trail/writer.js"
    expect(typeof createFileAuditTrailWriter).toBe("function");
  });
});
