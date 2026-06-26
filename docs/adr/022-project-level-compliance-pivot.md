# ADR-022 - Project-level compliance pivot vocabulary

**Status:** Accepted
**Date:** 2026-06-26

## Context

Sovri's compliance documentation has carried two product ideas at the same time:
AI PR code review with compliance references, and project-level compliance
engineering. That ambiguity pushed implementation work toward enum and category
changes instead of the project compliance rules engine.

The pivot vocabulary needs one stable source before MAT-113 implementation work
continues.

## Decision

Use the project-level compliance model `Framework -> Control -> Rule -> Evidence`
as the source language for compliance engineering. PR review output can project
relevant results from that model, but it is not the source model.

The core vocabulary is:

- **ComplianceGap** - project-level compliance output for an unmet control or missing evidence.
- **ControlResult** - result of evaluating a control against its rules and collected evidence.
- **Control** - framework requirement that the project must satisfy.
- **Rule** - technical verification attached to a control.
- **Evidence** - collected proof or observation used to support a control result or compliance gap.
- **FrameworkReference** - versioned framework citation with official text or source URL from a catalog.

`Finding` remains a diff/code issue raised during review. A `ComplianceGap` is
project-level compliance output and must not be modeled as a `Finding` category
or an enum-only review category.

Automatic output must say "potential compliance gap" or "requires review", not
"legal violation". Official framework text and source URLs come from versioned
catalogs, never LLM output.

## Consequences

- MAT-77: Superseded - enum-only compliance category scope is too narrow.
- MAT-113: Project compliance rules engine - framework controls, evidence, gaps.
  MAT-113 is the project compliance rules engine work for the core model
  `Framework -> Control -> Rule -> Evidence`.
- MAT-113 supersedes MAT-77: MAT-77 is superseded because enum-only
  compliance categories are too narrow for the project compliance rules engine.
- MAT-112 is the review output contract for projecting compliance gaps into PR
  output. It is scoped to PR/review output and is not the core domain model.
- MAT-113 owns the project compliance rules engine work and core
  rules-engine implementation shape.
- Framework catalogs must be versioned inputs to the engine.

## Rejected alternatives

- **Treat ComplianceGap as a Finding category:** keeps the PR review projection as
  the source model and loses project-level control/evidence semantics.
- **Let the LLM provide framework text:** breaks source traceability and risks
  invented regulatory language.
