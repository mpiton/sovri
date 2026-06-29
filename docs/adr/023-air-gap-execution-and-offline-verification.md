# ADR-023 — Air-gap rule execution and offline verification

**Status:** Accepted
**Date:** 2026-06-29

## Context

MAT-113 makes project-level compliance the product's center of gravity: a Rust agent runs
framework controls against a project and derives compliance gaps deterministically (ADR-020).
The target customers are regulated EU organisations (banking, health, defence, public sector)
whose scanning environments are frequently isolated from the public internet. A compliance
scan that silently depends on a SaaS call or an external regulatory API at execution time
cannot run in those environments and cannot be trusted as audit evidence.

The execution boundary has to be fixed before the repositories (MAT-81) and schemas (MAT-83)
harden, so the implementation cannot drift back to a network-coupled engine.

## Decision

Rule execution runs air-gapped in the `sovri-agent` workspace. No external API is required
during execution: a scan reads its framework catalogs and project evidence locally and
produces `ControlResult` and `ComplianceGap` output without contacting any network service.

Execution can be verified offline with no network access — the agent ships as a single
portable binary with a local store, and a scan run with the network disabled produces the same
results as one run with the network available. Importing or syncing results to `sovri-cloud` is
a separate step after the scan; it is never a dependency of execution. Rule execution stays in
the air-gapped `sovri-agent` and never runs in `sovri-cloud`.

## Consequences

- A compliance scan is reproducible in an isolated environment, a precondition for using its
  output as audit evidence (feeds the Compliance Trail, ADR-013/ADR-014).
- Offline verification becomes a testable property: CI can run a scan with the network disabled
  and assert identical output, so a regression that introduces a runtime network dependency
  fails fast.
- Framework text and source URLs must be present locally before execution, which is why they
  are catalog-backed and distributed through Git rather than fetched at run time (ADR-024).
- The LLM cannot sit on the execution path as a network service; its interpretation and ranking
  role runs outside the air-gapped deterministic core (ADR-026).

## Rejected alternatives

- **Fetch framework text from an external regulatory API during a scan:** makes execution depend on network uptime, breaks isolated deployments, and makes a run non-reproducible. Rejected — no external API may be required during execution.
- **Run rule execution in `sovri-cloud`:** moves the deterministic core behind a SaaS boundary and defeats air-gap operation. Rejected — rule execution stays in the air-gapped `sovri-agent`.
