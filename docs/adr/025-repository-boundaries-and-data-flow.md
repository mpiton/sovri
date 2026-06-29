# ADR-025 — Compliance repository boundaries and data flow

**Status:** Accepted
**Date:** 2026-06-29

## Context

MAT-113 is the product model for project-level compliance: a framework/control/rule/evidence
engine that detects project compliance gaps. Delivering it spans three new Rust repositories
(MAT-81) plus the existing platform, and the air-gap (ADR-023), Git-source (ADR-024), and
LLM-role (ADR-026) decisions only hold if each repository owns a clear slice and the data flows
through them in one fixed order. MAT-77's enum-only compliance category scope is too narrow and
is superseded; these boundaries are recorded before the repositories harden.

## Decision

Repository responsibilities are fixed as:

- `sovri-agent` — rule execution and local air-gap operation.
- `sovri-frameworks` — the Git source of truth for framework, control, and rule catalogs.
- `sovri-sdk-rust` — shared types and agent and cloud integration contracts.

`sovri-agent` integrates with `sovri-cloud` and `sovri` only at the reporting boundary: results
are imported and compliance gaps are projected into report and PR output there. Placing the
report and PR projection at the `sovri-cloud` and `sovri` boundary keeps rule execution inside
the air-gapped agent and out of the Cloud.

The compliance data flow is fixed end to end: catalog → rule → evidence → control result →
compliance gap → report and PR projection. Each stage is explicit and none is skipped — a rule
runs against a catalog, produces evidence, evidence yields a control result, and a compliance
gap requires a preceding control result before it can be projected into a report or a PR.

MAT-113 is the product model for project-level compliance, and MAT-77 is superseded by MAT-113.

## Consequences

- Each repository can be built and audited against a single responsibility, and the Apache-2.0
  agent, frameworks, and SDK stay separable from the proprietary Cloud (ADR-010).
- The ordered data flow gives every compliance gap a traceable lineage back through a control
  result, evidence, a rule, and a catalog entry — the shape the Compliance Trail records.
- Report and PR projection is a consumer at the edge, so the air-gapped core never depends on
  `sovri-cloud` to run.
- `sovri-sdk-rust` is the one place the agent and the Cloud agree on types, so a contract change
  is a single, reviewable surface.

## Rejected alternatives

- **Run rule execution in `sovri-cloud`:** breaks air-gap operation and couples evidence to a managed service. Rejected — rule execution stays in the air-gapped `sovri-agent`.
- **Derive a compliance gap directly from a rule:** skips control evaluation and loses the control and evidence lineage. Rejected — a compliance gap requires a preceding control result.
- **Keep MAT-77's enum-only compliance categories as the model:** too narrow for project compliance. Rejected — MAT-77 is superseded by MAT-113.
