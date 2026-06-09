// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCommunityAuditTrailWriter, type AuditTrailLogicalEvent } from "@sovri/compliance";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli, verifyTrailFile, type CliIo } from "./verify.js";

const TS = "2026-06-09T10:00:00Z";

const reviewStarted = {
  ts: TS,
  event: "review.started",
  pr_id: 1,
  commit_sha: "a".repeat(40),
  llm_provider: "anthropic",
  llm_model: "claude-opus-4-8",
} satisfies AuditTrailLogicalEvent;

const reviewCompleted = { ts: TS, event: "review.completed" } satisfies AuditTrailLogicalEvent;

let dir: string;
let trailPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sovri-cli-"));
  trailPath = join(dir, "trail.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeValidTrail(): Promise<string> {
  const { sink, publicKeyPem } = createCommunityAuditTrailWriter({ filePath: trailPath });
  await sink.append(reviewStarted);
  await sink.append(reviewCompleted);
  return publicKeyPem;
}

function captureIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (text) => out.push(text), err: (text) => err.push(text) }, out, err };
}

describe("verifyTrailFile (MAT-7)", () => {
  it("reports a valid trail using the key embedded in trail.started", async () => {
    await writeValidTrail();

    const result = await verifyTrailFile(trailPath);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("VALID");
  });

  it("reports a valid trail against an explicit public-key file", async () => {
    const publicKeyPem = await writeValidTrail();
    const keyPath = join(dir, "key.pem");
    await writeFile(keyPath, publicKeyPem, "utf-8");

    const result = await verifyTrailFile(trailPath, keyPath);

    expect(result.ok).toBe(true);
  });

  it("reports an invalid trail when an entry is tampered", async () => {
    await writeValidTrail();
    const lines = (await readFile(trailPath, "utf-8")).split("\n").filter((l) => l.length > 0);
    const tampered = JSON.parse(lines[1] as string) as { pr_id: number };
    tampered.pr_id = 999;
    lines[1] = JSON.stringify(tampered);
    await writeFile(trailPath, `${lines.join("\n")}\n`, "utf-8");

    const result = await verifyTrailFile(trailPath);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("entry 1");
  });

  it("rejects a trail with a malformed JSON line", async () => {
    await writeFile(trailPath, "not-json\n", "utf-8");

    await expect(verifyTrailFile(trailPath)).rejects.toThrow(/line 1/u);
  });

  it("treats an empty trail as vacuously valid", async () => {
    await writeFile(trailPath, "", "utf-8");

    const result = await verifyTrailFile(trailPath);

    expect(result.ok).toBe(true);
  });
});

describe("runCli (MAT-7)", () => {
  it("returns 0 and writes to stdout for a valid trail", async () => {
    await writeValidTrail();
    const { io, out } = captureIo();

    const code = await runCli(["verify", trailPath], io);

    expect(code).toBe(0);
    expect(out.join("")).toContain("VALID");
  });

  it("returns 1 and writes to stderr for a tampered trail", async () => {
    await writeValidTrail();
    const lines = (await readFile(trailPath, "utf-8")).split("\n").filter((l) => l.length > 0);
    const tampered = JSON.parse(lines[1] as string) as { pr_id: number };
    tampered.pr_id = 999;
    lines[1] = JSON.stringify(tampered);
    await writeFile(trailPath, `${lines.join("\n")}\n`, "utf-8");
    const { io, err } = captureIo();

    const code = await runCli(["verify", trailPath], io);

    expect(code).toBe(1);
    expect(err.join("")).toContain("INVALID");
  });

  it("returns 1 and prints usage when no command is given", async () => {
    const { io } = captureIo();

    const code = await runCli([], io);

    expect(code).toBe(1);
  });

  it("returns 1 when the trail path is missing", async () => {
    const { io, err } = captureIo();

    const code = await runCli(["verify"], io);

    expect(code).toBe(1);
    expect(err.join("")).toContain("Missing");
  });
});
