// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { SeveritySchema, z } from "@sovri/core";

// Canonical formats, kept local to the audit-trail module. The commit SHA mirrors the
// core review contract (`@sovri/core` Review.ts) so the trail is no laxer than the review.
const AuditReferencePattern = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/;
const CwePattern = /^CWE-\d+$/;
const CommitShaPattern = /^[a-f0-9]{40}$/;

// The emitter (orchestrator / Cloud wrapper) stamps `ts`; the writer never does.
const timestamp = z.iso.datetime();

const TrailStartedEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("trail.started"),
  trail_id: z.string(),
  public_key: z.string(),
});

const ReviewStartedEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("review.started"),
  pr_id: z.number().int().positive(),
  commit_sha: z.string().regex(CommitShaPattern),
  llm_provider: z.string(),
  llm_model: z.string(),
});

const LlmCalledEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("llm.called"),
  prompt_hash: z.string(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
});

const FindingCreatedEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("finding.created"),
  audit_reference: z.string().regex(AuditReferencePattern),
  severity: SeveritySchema,
  cwe: z.string().regex(CwePattern).optional(),
  compliance_references: z.array(z.string()),
});

const ReviewCompletedEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("review.completed"),
});

const ReviewFailedEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("review.failed"),
  error_code: z.string(),
  error_message: z.string(),
});

const CorrectionEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("correction"),
  target_audit_reference: z.string().regex(AuditReferencePattern),
  reason: z.string(),
  corrected_by: z.string(),
});

/**
 * Unsigned audit-trail event emitted by the review engine or a Cloud wrapper.
 * Carries `ts` + a discriminated `event` payload and never the chain/signature fields.
 */
export const AuditTrailLogicalEventSchema = z.discriminatedUnion("event", [
  TrailStartedEventSchema,
  ReviewStartedEventSchema,
  LlmCalledEventSchema,
  FindingCreatedEventSchema,
  ReviewCompletedEventSchema,
  ReviewFailedEventSchema,
  CorrectionEventSchema,
]);
export type AuditTrailLogicalEvent = z.infer<typeof AuditTrailLogicalEventSchema>;

// Chain + signature fields the writer adds on top of a logical event. Every entry after
// the first chains to a real predecessor, so `previous_hash` is non-null here.
const chainFields = {
  previous_hash: z.string(),
  entry_hash: z.string(),
  signature: z.string(),
};

// The trail's first entry (trail.started) has no predecessor: its `previous_hash` is
// exactly null, never a hash string.
const firstEntryChainFields = {
  ...chainFields,
  previous_hash: z.null(),
};

// Writer-generated closing seal (ADR-014): signed-only, records the final entry
// count (at least one entry). It is not a logical event, so it appears in the signed
// union alone, and as a closing entry its `previous_hash` is non-null.
const TrailCompletedSealSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("trail.completed"),
  entry_count: z.number().int().positive(),
  ...chainFields,
});

/**
 * Signed JSONL entry: a signed logical event (logical event + the writer's
 * `previous_hash` / `entry_hash` / `signature`), or the `trail.completed` seal.
 */
export const SignedAuditTrailEntrySchema = z.discriminatedUnion("event", [
  z.strictObject({ ...TrailStartedEventSchema.shape, ...firstEntryChainFields }),
  z.strictObject({ ...ReviewStartedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...LlmCalledEventSchema.shape, ...chainFields }),
  z.strictObject({ ...FindingCreatedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...ReviewCompletedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...ReviewFailedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...CorrectionEventSchema.shape, ...chainFields }),
  TrailCompletedSealSchema,
]);
export type SignedAuditTrailEntry = z.infer<typeof SignedAuditTrailEntrySchema>;
