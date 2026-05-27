# ADR-013 — Compliance Trail as primary differentiator

**Status:** Accepted
**Date:** 2026-05-27

## Context

Self-hosting in Europe and bring-your-own-key LLM support are necessary for Sovri's regulated EU target market, but they are no longer sufficient differentiators. Open-source PR review tools can be self-hosted, and provider abstraction makes BYOK increasingly common.

Sovri needs a product distinction that is specific to regulated EU enterprises and visible to CISOs, DPOs, auditors, and technical reviewers.

## Decision

Sovri's primary differentiator is **Compliance Trail**: the combination of potential compliance references on findings, a signed review audit trail, and future organisational learning with strict audit safeguards.

For v0.3, Sovri will ship the foundation:

- A public Apache 2.0 `@sovri/compliance` package.
- Deterministic compliance enrichment from CWE identifiers to framework references.
- Local versioned JSON mapping data, one file per CWE, imported at build time.
- Initial coverage for the CWE Top 25 2025 set plus CWE-798.
- No external mapping API.
- Public finding contracts extended with `compliance_references` and `audit_reference`.
- No automatically generated `confirmed` compliance references; automatic output is `applicable_if` or `informational`.
- Organisational Learning as documentation-only placeholder until a later Cloud release.

## Rationale

Regulated EU buyers need evidence and traceability more than another generic code review assistant. Mapping findings to audit-relevant references and producing a tamper-evident trail creates a concrete workflow advantage during security, privacy, and regulatory reviews.

The mapping must be deterministic because LLM-generated regulatory references would be too risky. The LLM may provide a CWE; Sovri maps that CWE to known references from local data. This keeps the behavior testable, offline, auditable, and compatible with self-hosted Community deployments.

The mapping package remains Apache 2.0 because Community code must stay auditable. The moat is not secrecy of the mapping alone; it is the combination of execution, audit format, customer trust, and future Cloud learning.

## Consequences

- `@sovri/core` owns the public finding shape for compliance references and audit references.
- `@sovri/compliance` depends on `@sovri/core`, but not on the review engine.
- `@sovri/review-engine` depends on `@sovri/compliance` for deterministic enrichment.
- Walkthrough output uses wording such as "Potential compliance references", not "compliance violations".
- Inline comments stay focused on the finding and only carry a discreet audit reference.
- Unknown or unmapped CWE identifiers do not block findings; they produce an empty compliance reference list.

## Rejected alternatives

- **Continue positioning on EU hosting and BYOK**: necessary, but commodified by self-hosted OSS tools and provider abstraction.
- **Let the LLM generate regulatory references**: richer output, but unacceptable hallucination and legal-risk surface.
- **Use an external mapping API in v0.3**: flexible updates, but adds network dependency, availability risk, authentication, caching, and version-governance complexity.
- **Keep the compliance mapping private**: protects data in the short term, but undermines Community auditability and the open-source adoption loop.
