# @sovri/compliance

Compliance mapping and audit-trail foundations for the Sovri AI code-review bot.
Deterministically enriches findings with framework references from a local CWE map,
and defines the signed, offline-verifiable audit trail. Apache-2.0, part of the
public Community surface.

## Install

```bash
pnpm add @sovri/compliance
```

This package is published as part of the Sovri monorepo. Internal builds consume
it through the workspace (`workspace:*`).

## Public API

```typescript
import {
  // Compliance mapping
  enrichFindingCompliance,
  ComplianceFrameworkSchema,
  ComplianceMappingEntrySchema,
  ComplianceReferenceApplicabilitySchema,
  ComplianceReferenceEntrySchema,
  type ComplianceFramework,
  type ComplianceMappingEntry,
  type ComplianceReferenceApplicability,
  type ComplianceReferenceEntry,
  // Catalog YAML schemas
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
  // Audit trail
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
  type AuditTrailSink,
  MemoryAuditTrailSink,
  verifyAuditTrail,
  type VerifyResult,
  // Opt-in Community audit-trail writer
  createCommunityAuditTrailWriter,
  type CommunityAuditTrailOptions,
  type CommunityAuditTrailWriter,
} from "@sovri/compliance";
```

### Compliance mapping

- `enrichFindingCompliance(finding)`: return a copy of the finding with
  `compliance_references` populated from the static CWE map (empty when the
  finding has no `cwe` or no mapping entry).
- `ComplianceMappingEntrySchema` / `ComplianceMappingEntry`: a single CWE mapping
  file (cwe id, title, MITRE url, impacts, references).
- `ComplianceReferenceEntrySchema` / `ComplianceReferenceEntry`: one framework
  reference (framework, identifier, description, official source url,
  applicability, optional condition).
- `ComplianceFrameworkSchema` / `ComplianceFramework`: the supported framework
  enum (CWE, OWASP, ISO 27001, GDPR, DORA, NIS2, AI-Act, CRA).
- `ComplianceReferenceApplicabilitySchema` / `ComplianceReferenceApplicability`:
  `applicable_if` vs `informational`.

### Catalog YAML schemas

- `CatalogSchemasByFile`: map from supported catalog YAML file names to their
  Zod schema (`framework.yaml`, `control.yaml`, `rule.yaml`, `mapping.yaml`).
- `FrameworkCatalogSchema` / `FrameworkCatalog`: framework metadata with a
  required version.
- `ControlCatalogSchema` / `ControlCatalog`: control metadata with required
  remediation.
- `RuleCatalogSchema` / `RuleCatalog`: rule metadata with required expected
  evidence.
- `MappingCatalogSchema` / `MappingCatalog`: control-to-framework-reference
  mapping with required `control_id`.
- `validateCatalogYaml(input)` / `CatalogYamlValidationInput` /
  `CatalogYamlValidationResult`: parse one catalog YAML document, reject empty or
  invalid YAML before schema validation, and return structured validation issues.
- `CatalogYamlValidationIssue`: structured validation issue with message and
  path segments.

### Audit trail

- `AuditTrailLogicalEventSchema` / `AuditTrailLogicalEvent`: the unsigned logical
  event union (`trail.started`, `review.started`, `llm.called`, `finding.created`,
  `review.completed`, `review.failed`, `correction`).
- `SignedAuditTrailEntrySchema` / `SignedAuditTrailEntry`: a logical event plus the
  writer's `previous_hash` / `entry_hash` / `signature` chain fields.
- `AuditTrailSink`: the orchestrator-facing port (`append(event): Promise<void>`).
- `MemoryAuditTrailSink`: in-memory `AuditTrailSink` for tests; stores unsigned
  events in insertion order and never signs.
- `verifyAuditTrail(entries, publicKey)`: offline hash-chain + Ed25519 verification
  of a `SignedAuditTrailEntry[]`, returning a discriminated `VerifyResult`.
- `VerifyResult`: `{ valid: true }` or `{ valid: false, failAt, reason }`.
- `createCommunityAuditTrailWriter(options)` / `CommunityAuditTrailOptions` /
  `CommunityAuditTrailWriter`: an opt-in, file-backed `AuditTrailSink`. It prepends the
  `trail.started` genesis the review orchestrator does not emit and owns its Ed25519 key
  (operator-provided PEM, or an ephemeral key per trail), returning the sink plus its
  public key so the resulting trail verifies offline.

### Internal (not exported)

`createSigner` (`./audit-trail/signer.js`) and `createFileAuditTrailWriter`
(`./audit-trail/writer.js`) stay **internal** and are intentionally not exported from the
package barrel. The public `createCommunityAuditTrailWriter` wraps them so callers never
handle the raw signer or key material directly; the Cloud writer is the other caller.
Keeping the low-level factories off the public surface keeps the attack surface small.

## Status

v0.3 — mapping covers the CWE Top 25 (2025) plus CWE-798; the audit-trail schemas,
the in-memory sink, and the offline verifier are stable. The Cloud edition consumes
this package; no Cloud-only code lives here.
