// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { z } from "zod";

// Telemetry redaction guard for @sovri/observability (docs/adr/019, ARCHI §10.2.2-§10.2.3). One
// allowlist + one pure scrubber that gates every span attribute / metric tag before it reaches an
// OTel span or meter: an off-allowlist key is dropped, a secret-shaped value is censored to the
// shared "[Redacted]" token, and only scalar values pass. Mirrors the REDACT_PATHS discipline in
// logger.ts so logs and telemetry redact consistently. The single choke point is withSpan /
// recordMetric (tracing.ts), so the review-engine instrumentation gets the guard for free and no
// producer can bypass it.

// The single source of truth for permitted keys. The four span attributes and nine metric tags from
// ARCHI §10.2.2-§10.2.3, plus the three non-sensitive operational attributes the review-engine spans
// already carry (fetch_diff counts `changed_files` / `reviewable_files`, llm_call `provider.model`).
// The key type is derived from this enum via z.infer (R-08), so adding an attribute or tag means
// extending the enum, never an ad-hoc bypass.
const AllowedTelemetryKeySchema = z.enum([
  // ARCHI §10.2.2 — review.pull_request span attributes
  "pr.number",
  "pr.repo",
  "llm.provider",
  "findings.count",
  // Non-sensitive operational span attributes (review.fetch_diff / review.llm_call)
  "changed_files",
  "reviewable_files",
  "provider.model",
  // ARCHI §10.2.3 — metric tags
  "status",
  "llm_provider",
  "severity",
  "category",
  "source",
  "provider",
  "model",
  "direction",
  "error_type",
]);

export type AllowedTelemetryKey = z.infer<typeof AllowedTelemetryKeySchema>;

export const ALLOWED_TELEMETRY_KEYS: readonly AllowedTelemetryKey[] =
  AllowedTelemetryKeySchema.options;

// O(1) membership for the per-attribute gate.
const ALLOWED_KEY_SET: ReadonlySet<string> = new Set(ALLOWED_TELEMETRY_KEYS);

// Identical to the Pino redaction censor in logger.ts so logs and telemetry redact consistently.
const CENSOR = "[Redacted]";

// Secret-pattern set, named and grouped by family for single-grep auditability — mirroring the
// REDACT_PATHS rationale in logger.ts. Detection is shape-anchored: each pattern requires a realistic
// token tail so a benign value that merely contains the literal "sk-" (e.g. "task-131") is NOT
// censored. The regexes are non-global so `.test()` stays stateless and the guard deterministic.
// GitHub credential prefixes: classic PAT (ghp_), OAuth (gho_), App user (ghu_), App refresh (ghr_),
// App installation (ghs_, including the stateless ghs_APPID_JWT format whose JWT tail carries "." and
// "-"), and fine-grained PAT (github_pat_). The tail allows ".-_" so stateless installation tokens
// are caught as opaque strings.
export const GITHUB_TOKEN_PATTERN: RegExp = /(?:gh[posur]_|github_pat_)[A-Za-z0-9._-]{16,}/u;
export const LLM_API_KEY_PATTERN: RegExp = /sk-[A-Za-z0-9]{16,}/u;
export const PEM_PRIVATE_KEY_PATTERN: RegExp = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;

// A raw webhook payload smuggled as a JSON string: a value that JSON-parses to a plain object
// exposing a GitHub webhook marker key. The marker list is the grep-auditable surface.
export const WEBHOOK_MARKER_KEYS: readonly string[] = [
  "installation",
  "pull_request",
  "sender",
  "repository",
  "organization",
  "hook",
];

function looksLikeWebhookPayload(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  return WEBHOOK_MARKER_KEYS.some((key) => Object.hasOwn(parsed, key));
}

function isSecretValue(value: string): boolean {
  return (
    GITHUB_TOKEN_PATTERN.test(value) ||
    LLM_API_KEY_PATTERN.test(value) ||
    PEM_PRIVATE_KEY_PATTERN.test(value) ||
    looksLikeWebhookPayload(value)
  );
}

// Input boundary — a record of unknown values. Validating here defends the untyped callers
// (config, JSON, LLM output) the static type cannot reach: an invalid shape sanitizes to {} rather
// than throwing, keeping the guard total (R-05).
const TelemetryInputSchema = z.record(z.string(), z.unknown());

// Output contract — only the scalar union may leave the guard. The public return type is derived via
// z.infer (R-08, R-10) so a caller cannot smuggle a non-scalar attribute past the type system.
const SanitizedTelemetryAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export type SanitizedTelemetryAttributes = z.infer<typeof SanitizedTelemetryAttributesSchema>;

/**
 * Drop every off-allowlist key and censor every secret-shaped scalar value to "[Redacted]" before
 * the attribute / tag map reaches a span or meter. Pure, total, deterministic — no I/O, no clock,
 * no random, no throw on malformed input (R-05).
 *
 * - A key not in {@link ALLOWED_TELEMETRY_KEYS} is dropped (R-01).
 * - A string value matching a GitHub-token / LLM-key / PEM / webhook-payload pattern is replaced
 *   with "[Redacted]" (R-02, R-03).
 * - Only `string | number | boolean` values pass; objects, arrays, functions, null, and undefined
 *   are dropped (R-04), bounding tag cardinality and preventing nested-payload leakage.
 *
 * @param input - An arbitrary attribute/tag map from any (possibly untyped) producer. Accepts
 *   `unknown` so callers at the telemetry boundary need no cast; a non-record input sanitizes to `{}`.
 * @returns A fresh record holding only allowlisted keys with scalar, secret-free values.
 */
export function sanitizeTelemetryAttributes(input: unknown): SanitizedTelemetryAttributes {
  const parsed = TelemetryInputSchema.safeParse(input);
  const record: Record<string, unknown> = parsed.success ? parsed.data : {};

  const out: SanitizedTelemetryAttributes = {};
  for (const [key, value] of Object.entries(record)) {
    if (!ALLOWED_KEY_SET.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      out[key] = isSecretValue(value) ? CENSOR : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
    // Any other type (object, array, function, null, undefined, symbol, bigint) is dropped.
  }
  return out;
}
