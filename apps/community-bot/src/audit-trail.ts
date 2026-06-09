// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { createPrivateKey } from "node:crypto";
import { join } from "node:path";

import { createCommunityAuditTrailWriter, type AuditTrailSink } from "@sovri/compliance";

import type { ReviewPostTarget } from "./handlers/pull-request.js";
import { DeploymentConfigError } from "./runtime-env.js";

// Opt-in, instance-level concern: the trail is written to the bot host's disk, so it is configured
// through environment variables (never `.sovri.yml`, which a reviewed repository controls). The bot
// runs with a read-only filesystem except for the mounted trail directory, so SOVRI_AUDIT_TRAIL_PATH
// must point at a writable volume.
const ENABLED_VALUES = new Set(["1", "on", "true", "yes"]);
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]/gu;

/** Per-review context used to derive a unique trail filename. */
export interface AuditTrailSinkInput {
  readonly deliveryId: string;
  readonly target: ReviewPostTarget;
}

/** Builds the audit-trail sink for one review, or `undefined` when the feature is disabled. */
export type AuditTrailSinkFactory = (input: AuditTrailSinkInput) => AuditTrailSink | undefined;

interface AuditTrailConfig {
  readonly directory: string;
  readonly privateKeyPem: string | undefined;
}

function readAuditTrailConfig(env: NodeJS.ProcessEnv): AuditTrailConfig | undefined {
  const flag = env.SOVRI_AUDIT_TRAIL?.trim().toLowerCase();
  if (flag === undefined || !ENABLED_VALUES.has(flag)) {
    return undefined;
  }

  const directory = env.SOVRI_AUDIT_TRAIL_PATH?.trim();
  if (directory === undefined || directory.length === 0) {
    throw new DeploymentConfigError(
      "SOVRI_AUDIT_TRAIL is enabled but SOVRI_AUDIT_TRAIL_PATH (a writable directory) is not set",
    );
  }

  return { directory, privateKeyPem: readOptionalPrivateKey(env) };
}

function readOptionalPrivateKey(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.SOVRI_AUDIT_TRAIL_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    createPrivateKey(raw);
  } catch {
    throw new DeploymentConfigError(
      "SOVRI_AUDIT_TRAIL_PRIVATE_KEY must contain a valid PEM private key",
    );
  }
  return raw;
}

// One file per webhook delivery: distinct trails never share a writer, so concurrent reviews
// cannot interleave entries onto the same hash chain.
function trailFileName(input: AuditTrailSinkInput): string {
  const repo = input.target.repoFullName.replaceAll(UNSAFE_FILENAME_CHARS, "_");
  return `${repo}__pr${String(input.target.number)}__${input.target.commitSha}__${input.deliveryId}.jsonl`;
}

/**
 * Build the audit-trail sink factory from deployment environment variables.
 *
 * Configuration is read lazily per review so a misconfiguration surfaces as a
 * {@link DeploymentConfigError} on the review path (reported like any other deployment error)
 * rather than crashing the bot at startup. When SOVRI_AUDIT_TRAIL is unset or falsy the returned
 * factory always yields `undefined`, leaving the review path byte-for-byte unchanged.
 */
export function createAuditTrailSinkFactory(
  env: NodeJS.ProcessEnv = process.env,
): AuditTrailSinkFactory {
  return (input) => {
    const config = readAuditTrailConfig(env);
    if (config === undefined) {
      return undefined;
    }
    const filePath = join(config.directory, trailFileName(input));
    // exactOptionalPropertyTypes: only set privateKeyPem when the operator supplied one,
    // otherwise the writer generates an ephemeral key per trail.
    const writer =
      config.privateKeyPem === undefined
        ? createCommunityAuditTrailWriter({ filePath })
        : createCommunityAuditTrailWriter({ filePath, privateKeyPem: config.privateKeyPem });
    return writer.sink;
  };
}
