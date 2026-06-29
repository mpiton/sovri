# ADR-027 — ComplianceGap and ControlResult are distinct from the PR Finding

**Status:** Accepted
**Date:** 2026-06-29

## Context

Sovri produces two kinds of output. PR review raises a `Finding` — a diff or code issue on a
hunk, on the CWE-backed enrichment path (ADR-021). Project-level compliance, the MAT-113 model,
evaluates framework controls and produces `ControlResult` and `ComplianceGap`. ADR-021 already
keeps the non-CWE `ComplianceGap` output off the PR review taxonomy, and ADR-022 fixed the
vocabulary and warned that a `ComplianceGap` must not be modeled as a `Finding` category. This
ADR makes that type boundary an explicit architectural decision so the agent and SDK
(MAT-81/MAT-83) cannot collapse project compliance into generic code review.

## Decision

`ComplianceGap` is a project-level compliance type, distinct from the pull-request `Finding`.
`ControlResult` is a project-level compliance type, distinct from the pull-request `Finding`. A
`ControlResult` is the result of evaluating a control against its rules and collected evidence;
a `ComplianceGap` is project-level compliance output for an unmet control or missing evidence. A
`ComplianceGap` is not a `Finding` and a `ControlResult` is not a `Finding`; a PR
`category: "compliance"` renderer is only a projection over `ComplianceGap`, never its source.

## Consequences

- The agent and `sovri-sdk-rust` model `ControlResult` and `ComplianceGap` as their own types, so
  compliance output keeps its control and evidence lineage instead of degrading to a severity and
  a code location.
- PR review and project compliance can share a projection at the edge (ADR-025) without merging
  their types, so a change to the `Finding` taxonomy does not silently reshape compliance output.
- Schema work (MAT-83) starts from a fixed type boundary rather than reconciling it later.

## Rejected alternatives

- **Model `ComplianceGap` as a `Finding` subtype:** collapses project compliance into the PR review taxonomy and loses control and evidence lineage. Rejected — `ComplianceGap` stays distinct from the pull-request `Finding`.
- **Model `ControlResult` as a `Finding`:** conflates a control evaluation with a diff issue. Rejected — `ControlResult` stays distinct from the pull-request `Finding`.
