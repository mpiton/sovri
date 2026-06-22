// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SignedAuditTrailEntrySchema,
  verifyAuditTrail,
  type AuditTrailLogicalEvent,
} from "@sovri/compliance";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuditTrailSinkFactory, type AuditTrailSinkInput } from "./audit-trail.js";
import { DeploymentConfigError } from "./runtime-env.js";

const input: AuditTrailSinkInput = {
  deliveryId: "delivery-123",
  target: {
    baseRef: "main",
    baseSha: "b".repeat(40),
    commitSha: "a".repeat(40),
    number: 42,
    repoFullName: "octo/repo",
  },
};

const reviewStarted = {
  ts: "2026-06-09T10:00:00Z",
  event: "review.started",
  pr_id: 42,
  commit_sha: "a".repeat(40),
  llm_provider: "anthropic",
  llm_model: "claude-opus-4-8",
} satisfies AuditTrailLogicalEvent;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sovri-bot-audit-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createAuditTrailSinkFactory (MAT-7)", () => {
  it("returns no sink when SOVRI_AUDIT_TRAIL is unset", () => {
    const factory = createAuditTrailSinkFactory({});

    expect(factory(input)).toBeUndefined();
  });

  it("returns no sink when SOVRI_AUDIT_TRAIL is a falsy value", () => {
    const factory = createAuditTrailSinkFactory({ SOVRI_AUDIT_TRAIL: "off" });

    expect(factory(input)).toBeUndefined();
  });

  it("writes a per-review JSONL trail under the configured directory when enabled", async () => {
    const factory = createAuditTrailSinkFactory({
      SOVRI_AUDIT_TRAIL: "on",
      SOVRI_AUDIT_TRAIL_PATH: dir,
    });

    const sink = factory(input);
    expect(sink).toBeDefined();
    await sink?.append(reviewStarted);

    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const [name] = files;
    expect(name).toContain("octo_repo__pr42__");
    expect(name).toContain("delivery-123");
  });

  it("produces a trail that verifies offline against its embedded key", async () => {
    const factory = createAuditTrailSinkFactory({
      SOVRI_AUDIT_TRAIL: "1",
      SOVRI_AUDIT_TRAIL_PATH: dir,
    });
    await factory(input)?.append(reviewStarted);

    const [name] = await readdir(dir);
    const entries = (await readFile(join(dir, name as string), "utf-8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => SignedAuditTrailEntrySchema.parse(JSON.parse(line)));
    const genesis = entries[0];
    if (genesis?.event !== "trail.started") {
      throw new Error("expected a trail.started genesis entry");
    }

    expect(verifyAuditTrail(entries, createPublicKey(genesis.public_key))).toStrictEqual({
      valid: true,
    });
  });

  it("honours an operator-provided Ed25519 private key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const factory = createAuditTrailSinkFactory({
      SOVRI_AUDIT_TRAIL: "true",
      SOVRI_AUDIT_TRAIL_PATH: dir,
      SOVRI_AUDIT_TRAIL_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    await factory(input)?.append(reviewStarted);

    const [name] = await readdir(dir);
    const entries = (await readFile(join(dir, name as string), "utf-8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => SignedAuditTrailEntrySchema.parse(JSON.parse(line)));

    expect(verifyAuditTrail(entries, publicKey)).toStrictEqual({ valid: true });
  });

  it("throws a DeploymentConfigError when enabled without an output path", () => {
    const factory = createAuditTrailSinkFactory({ SOVRI_AUDIT_TRAIL: "on" });

    expect(() => factory(input)).toThrow(DeploymentConfigError);
  });

  it("throws a DeploymentConfigError when the private key is not valid PEM", () => {
    const factory = createAuditTrailSinkFactory({
      SOVRI_AUDIT_TRAIL: "on",
      SOVRI_AUDIT_TRAIL_PATH: dir,
      SOVRI_AUDIT_TRAIL_PRIVATE_KEY: "not-a-key",
    });

    expect(() => factory(input)).toThrow(DeploymentConfigError);
  });
});
