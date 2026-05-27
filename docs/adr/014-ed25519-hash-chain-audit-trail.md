# ADR-014 — Ed25519 hash-chain audit trail

**Status:** Accepted
**Date:** 2026-05-27

## Context

Compliance Trail requires review evidence that can be verified offline by an auditor. A plain log file is easy to edit. A per-line signature detects line tampering, but does not reliably expose deletion or reordering. A server-side audit log would weaken self-hosted verification and introduce infrastructure that is not needed for the v0.3 foundation.

The audit trail must work without a network dependency, without a proprietary verification service, and without adding a sensitive crypto dependency to the supply chain.

## Decision

Sovri audit trails use JSONL entries linked by a hash chain and signed with Ed25519 through Node.js native `node:crypto`.

Each entry includes the previous entry hash, its own entry hash, and an Ed25519 signature. The first entry starts the trail and carries the public key. The trail closes with a `trail.completed` seal entry that records the final entry count and is itself signed and chained. The verifier can also accept an expected public key, an expected final hash, and an expected entry count, and fails if any of these differ or if the seal is missing when one is required.

In v0.3, audit writing is activated by injecting an `AuditTrailSink` into the review engine. Without a sink, reviews run normally. The compliance package provides an in-memory sink for tests, a file writer for JSONL output, signing helpers, and a verifier API. A public CLI is deferred.

## Rationale

Ed25519 is fast, widely supported, has compact keys and signatures, and avoids the signature-time randomness pitfalls of ECDSA. Node.js 24 supports Ed25519 natively, so Sovri does not need a third-party crypto library for the foundation.

A hash chain makes interior modification, deletion, and reordering tamper-evident: any altered entry breaks the chain at the next link. Truncation of the tail is a different threat: an attacker who drops the last N entries leaves a still-valid prefix. The `trail.completed` seal entry plus an out-of-band checkpoint (expected final hash, entry count, or both — for example committed in a PR comment or sent to an external ledger) close this gap by forcing the verifier to detect a missing or shortened tail. JSONL keeps the format open, streamable, SIEM-friendly, and readable without Sovri.

The injected sink keeps the review engine testable and avoids making file I/O mandatory in Community deployments.

## Consequences

- Audit trail integrity is tamper-evident, not magically immutable. Files can still be edited, but edits fail verification.
- Key generation and key storage are outside v0.3. Callers inject key material explicitly.
- Audit events must not contain raw prompts, raw diffs, raw webhook payloads, secrets, tokens, or complete finding bodies.
- v0.3 audit events cover the review pipeline: `trail.started`, `review.started`, `llm.called`, `finding.created`, `review.completed`, `review.failed`, `correction`, and `trail.completed`.
- Human lifecycle events such as `finding.resolved` are deferred until the product flow exists.
- Tail truncation is detected only when the verifier is given an expected final hash or entry count, or when a `trail.completed` seal is required. Without either signal an attacker can drop the latest entries and the remaining prefix still verifies.

## Rejected alternatives

- **Unsigned JSONL**: readable, but cannot support offline integrity verification.
- **Per-line signatures without hash chaining**: detects edits to a line, but not enough evidence for deletion and reordering.
- **HMAC**: fast and simple, but symmetric keys are weaker for third-party offline verification.
- **RSA or ECDSA**: widely known, but larger or more operationally fragile than Ed25519 for this use case.
- **Mandatory audit writer in the bot**: closer to production behavior, but too intrusive for the v0.3 foundation.
