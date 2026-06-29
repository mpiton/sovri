// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

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

// Catalog schemas: YAML compliance-as-code validation for framework catalogs.
export {
  CatalogSchemasByFile,
  ControlCatalogSchema,
  FrameworkCatalogSchema,
  MappingCatalogSchema,
  RuleCatalogSchema,
  validateCatalogYaml,
  type CatalogYamlValidationInput,
  type CatalogYamlValidationIssue,
  type CatalogYamlValidationResult,
  type ControlCatalog,
  type FrameworkCatalog,
  type MappingCatalog,
  type RuleCatalog,
} from "./catalog/schema.js";

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
// Opt-in Community file writer: owns key material, prepends the trail.started genesis,
// and exposes only the sink plus its public key (the raw signer/writer stay internal).
export {
  createCommunityAuditTrailWriter,
  type CommunityAuditTrailOptions,
  type CommunityAuditTrailWriter,
} from "./audit-trail/community-writer.js";
