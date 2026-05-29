// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const compliancePackageName = "@sovri/compliance";

export {
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
} from "./audit-trail/schema.js";

export { type AuditTrailSink, MemoryAuditTrailSink } from "./audit-trail/sink.js";

export { verifyAuditTrail, type VerifyResult } from "./audit-trail/verifier.js";

export { enrichFindingCompliance } from "./mapping/enricher.js";
export { getCweMap } from "./mapping/loader.js";
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
