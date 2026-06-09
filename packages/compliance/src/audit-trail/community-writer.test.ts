// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCommunityAuditTrailWriter } from "./community-writer.js";
import { SignedAuditTrailEntrySchema, type AuditTrailLogicalEvent } from "./schema.js";
import { verifyAuditTrail } from "./verifier.js";

const TS = "2026-06-09T10:00:00Z";

const reviewStarted = {
  ts: TS,
  event: "review.started",
  pr_id: 1,
  commit_sha: "a".repeat(40),
  llm_provider: "anthropic",
  llm_model: "claude-opus-4-8",
} satisfies AuditTrailLogicalEvent;

const reviewCompleted = {
  ts: TS,
  event: "review.completed",
} satisfies AuditTrailLogicalEvent;

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sovri-audit-"));
  filePath = join(dir, "trail.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readEntries(path: string) {
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => SignedAuditTrailEntrySchema.parse(JSON.parse(line)));
}

describe("createCommunityAuditTrailWriter — genesis + chain (MAT-7)", () => {
  it("prepends a trail.started genesis before the first forwarded event", async () => {
    // Given a community writer with an ephemeral key
    const { sink } = createCommunityAuditTrailWriter({ filePath });

    // When the orchestrator emits review.started first
    await sink.append(reviewStarted);

    // Then the file starts with a trail.started genesis, then the forwarded event
    const entries = await readEntries(filePath);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.event).toBe("trail.started");
    expect(entries[0]?.previous_hash).toBeNull();
    expect(entries[1]?.event).toBe("review.started");
  });

  it("produces a trail that verifies valid with the returned public key", async () => {
    // Given a community writer
    const { sink, publicKeyPem } = createCommunityAuditTrailWriter({ filePath });

    // When a full review lifecycle is appended
    await sink.append(reviewStarted);
    await sink.append(reviewCompleted);

    // Then the on-disk trail verifies offline against the returned public key
    const entries = await readEntries(filePath);
    const result = verifyAuditTrail(entries, createPublicKey(publicKeyPem));
    expect(result).toStrictEqual({ valid: true });
  });

  it("emits the genesis only once across multiple appends", async () => {
    // Given a community writer
    const { sink } = createCommunityAuditTrailWriter({ filePath });

    // When several events are appended
    await sink.append(reviewStarted);
    await sink.append(reviewCompleted);

    // Then exactly one trail.started entry exists
    const entries = await readEntries(filePath);
    const genesisCount = entries.filter((entry) => entry.event === "trail.started").length;
    expect(genesisCount).toBe(1);
  });

  it("uses the operator-provided Ed25519 private key when given", async () => {
    // Given an operator key pair
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const expectedPublicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    // When the writer is built with that private key
    const { sink, publicKeyPem } = createCommunityAuditTrailWriter({ filePath, privateKeyPem });
    await sink.append(reviewStarted);

    // Then the returned public key derives from the operator key, and the trail verifies
    expect(publicKeyPem).toBe(expectedPublicPem);
    const entries = await readEntries(filePath);
    expect(verifyAuditTrail(entries, publicKey)).toStrictEqual({ valid: true });
  });

  it("keeps the genesis pending when the first write fails, so a retry re-emits it", async () => {
    // Given a writer whose target directory does not exist yet
    const missingDir = join(dir, "missing");
    const missingPath = join(missingDir, "trail.jsonl");
    const { sink } = createCommunityAuditTrailWriter({ filePath: missingPath });

    // When the first append fails because the directory is absent
    await expect(sink.append(reviewStarted)).rejects.toThrow();

    // And the directory is created and the append retried
    await mkdir(missingDir, { recursive: true });
    await sink.append(reviewStarted);

    // Then the trail still opens with exactly one trail.started genesis
    const entries = await readEntries(missingPath);
    expect(entries[0]?.event).toBe("trail.started");
    expect(entries.filter((entry) => entry.event === "trail.started")).toHaveLength(1);
  });

  it("generates a distinct ephemeral key per writer when no key is provided", async () => {
    // Given two ephemeral writers
    const first = createCommunityAuditTrailWriter({ filePath });
    const second = createCommunityAuditTrailWriter({ filePath: join(dir, "other.jsonl") });

    // Then their public keys differ
    expect(first.publicKeyPem).not.toBe(second.publicKeyPem);
  });
});
