// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

// Compliance mapping: deterministic finding enrichment plus the mapping schemas.
export { enrichFindingCompliance } from "./mapping/enricher.js";
export {
  ComplianceFrameworkSchema,
  ComplianceMappingEntrySchema,
  ComplianceReferenceApplicabilitySchema,
  ComplianceReferenceEntrySchema,
  type ComplianceFramework,
  type ComplianceMappingEntry,
  type ComplianceReferenceApplicability,
  type ComplianceReferenceEntry,
} from "./mapping/schema.js";

// Audit trail: validated event/entry schemas, the sink interface and its
// in-memory implementation, and the offline verifier.
export {
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "./audit-trail/schema.js";
export { type AuditTrailSink, MemoryAuditTrailSink } from "./audit-trail/sink.js";
export { verifyAuditTrail, type VerifyResult } from "./audit-trail/verifier.js";
