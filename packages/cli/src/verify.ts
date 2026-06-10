// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  SignedAuditTrailEntrySchema,
  verifyAuditTrail,
  type SignedAuditTrailEntry,
} from "@sovri/compliance";

/** Result of verifying one trail file: a process-friendly ok flag plus a human-readable line. */
export interface VerifyTrailResult {
  readonly ok: boolean;
  readonly message: string;
}

/** Sink for CLI output, injected so the command stays testable without touching process streams. */
export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const USAGE = `sovri — Sovri audit-trail tools

Usage:
  sovri verify <trail.jsonl> [--public-key <key.pem>]

Verify an audit trail offline (Ed25519 hash chain + signatures). The signing
public key is read from the trail's trail.started entry unless --public-key
pins a known key. Exit code 0 if valid, 1 otherwise.`;

/** Thrown when a trail file is not well-formed JSONL of signed audit-trail entries. */
class TrailParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TrailParseError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTrail(content: string): SignedAuditTrailEntry[] {
  return content
    .split("\n")
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter(({ text }) => text.length > 0)
    .map(({ text, number }) => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (cause) {
        throw new TrailParseError(`line ${number} is not valid JSON`, { cause });
      }
      const parsed = SignedAuditTrailEntrySchema.safeParse(json);
      if (!parsed.success) {
        throw new TrailParseError(`line ${number} is not a valid audit-trail entry`, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    });
}

function resolvePublicKey(
  entries: readonly SignedAuditTrailEntry[],
  explicitPem: string | undefined,
): KeyObject | undefined {
  if (explicitPem !== undefined) {
    return createPublicKey(explicitPem);
  }
  const first = entries[0];
  if (first === undefined) {
    return undefined;
  }
  if (first.event !== "trail.started") {
    throw new TrailParseError(
      "trail does not open with a trail.started entry; pass --public-key to verify",
    );
  }
  return createPublicKey(first.public_key);
}

/** Read, parse, and verify a JSONL audit trail. Throws {@link TrailParseError} on malformed input. */
export async function verifyTrailFile(
  trailPath: string,
  publicKeyPath?: string,
): Promise<VerifyTrailResult> {
  const entries = parseTrail(await readFile(trailPath, "utf-8"));
  const explicitPem =
    publicKeyPath === undefined ? undefined : await readFile(publicKeyPath, "utf-8");
  const publicKey = resolvePublicKey(entries, explicitPem);

  if (publicKey === undefined) {
    return { ok: true, message: `${trailPath}: VALID — empty trail (vacuously valid)` };
  }

  const result = verifyAuditTrail(entries, publicKey);
  if (result.valid) {
    return {
      ok: true,
      message: `${trailPath}: VALID — ${entries.length} entries, chain and signatures intact`,
    };
  }
  return { ok: false, message: `${trailPath}: INVALID — entry ${result.failAt}: ${result.reason}` };
}

/** Run the `sovri` CLI for one argv vector, writing through {@link CliIo}. Returns the exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) {
    io.err(`${USAGE}\n`);
    return 1;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    io.out(`${USAGE}\n`);
    return 0;
  }
  if (command !== "verify") {
    io.err(`Unknown command: ${command}\n${USAGE}\n`);
    return 1;
  }

  let positionals: readonly string[];
  let publicKey: string | undefined;
  try {
    const parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      options: { "public-key": { type: "string" } },
    });
    positionals = parsed.positionals;
    publicKey = parsed.values["public-key"];
  } catch (cause) {
    io.err(`${errorMessage(cause)}\n`);
    return 1;
  }

  const trailPath = positionals[0];
  if (trailPath === undefined) {
    io.err(`Missing <trail.jsonl> argument.\n${USAGE}\n`);
    return 1;
  }

  try {
    const result = await verifyTrailFile(trailPath, publicKey);
    if (result.ok) {
      io.out(`${result.message}\n`);
      return 0;
    }
    io.err(`${result.message}\n`);
    return 1;
  } catch (cause) {
    io.err(`verify failed: ${errorMessage(cause)}\n`);
    return 1;
  }
}
