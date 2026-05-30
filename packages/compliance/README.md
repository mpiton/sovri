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
  // Audit trail
  AuditTrailLogicalEventSchema,
  SignedAuditTrailEntrySchema,
  type AuditTrailLogicalEvent,
  type SignedAuditTrailEntry,
  type AuditTrailSink,
  MemoryAuditTrailSink,
  verifyAuditTrail,
  type VerifyResult,
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

### Internal in v0.3 (not exported)

`createSigner` (`./audit-trail/signer.js`) and `createFileAuditTrailWriter`
(`./audit-trail/writer.js`) are **internal in v0.3** and intentionally not exported
from the package barrel. They are reserved for the Cloud writer, which owns the
Ed25519 key material and the `trail_id`; keeping them off the public surface keeps
the v0.3 attack surface small.

## Status

v0.3 — mapping covers the CWE Top 25 (2025) plus CWE-798; the audit-trail schemas,
the in-memory sink, and the offline verifier are stable. The Cloud edition consumes
this package; no Cloud-only code lives here.
