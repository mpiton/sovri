// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

import { SeveritySchema, z } from "@sovri/core";

// Canonical audit-reference and CWE formats, kept local to the audit-trail module.
const AuditReferencePattern = /^SOVRI-[A-Z]{2}-[A-F0-9]{4}-[A-F0-9]{4}$/;
const CwePattern = /^CWE-\d+$/;

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
  pr_id: z.number(),
  commit_sha: z.string(),
  llm_provider: z.string(),
  llm_model: z.string(),
});

const LlmCalledEventSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("llm.called"),
  prompt_hash: z.string(),
  tokens_in: z.number(),
  tokens_out: z.number(),
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

// Chain + signature fields the writer adds on top of a logical event.
// `previous_hash` is null for the first entry of a trail.
const chainFields = {
  previous_hash: z.string().nullable(),
  entry_hash: z.string(),
  signature: z.string(),
};

// Writer-generated closing seal (ADR-014): signed-only, records the final entry
// count. It is not a logical event, so it appears in the signed union alone.
const TrailCompletedSealSchema = z.strictObject({
  ts: timestamp,
  event: z.literal("trail.completed"),
  entry_count: z.number().int().nonnegative(),
  ...chainFields,
});

/**
 * Signed JSONL entry: a signed logical event (logical event + the writer's
 * `previous_hash` / `entry_hash` / `signature`), or the `trail.completed` seal.
 */
export const SignedAuditTrailEntrySchema = z.discriminatedUnion("event", [
  z.strictObject({ ...TrailStartedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...ReviewStartedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...LlmCalledEventSchema.shape, ...chainFields }),
  z.strictObject({ ...FindingCreatedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...ReviewCompletedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...ReviewFailedEventSchema.shape, ...chainFields }),
  z.strictObject({ ...CorrectionEventSchema.shape, ...chainFields }),
  TrailCompletedSealSchema,
]);
export type SignedAuditTrailEntry = z.infer<typeof SignedAuditTrailEntrySchema>;
