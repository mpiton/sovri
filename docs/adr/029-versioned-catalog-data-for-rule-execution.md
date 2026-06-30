# ADR-029 — Versioned catalog data for rule execution

**Status:** Accepted
**Date:** 2026-06-29

## Context

ADR-024 makes Git the source of truth for framework catalogs, and ADR-028 keeps source metadata
inside catalog files. MAT-83 also needs the execution path to stay deterministic: schemas describe
catalog files, and rule execution must consume reviewed catalog data rather than prompt text or
runtime guesses.

## Decision

Framework catalogs flow to rules as versioned catalog data. Rule execution uses versioned catalog data.
The rule engine resolves controls, rules, references, and source metadata from a reviewed catalog
revision before evaluating evidence, so the same catalog revision and evidence input produce the
same control result.

## Consequences

- Rule behavior is reviewed through catalog changes, not hidden in prompts or runtime service state.
- Audit trails can name the catalog revision that supplied each rule and framework reference.
- Offline execution can replay the same versioned catalog data without fetching live regulatory
  text or asking the LLM to reconstruct a rule.

## Rejected alternatives

- **Generate rules from prompt context at scan time:** makes execution non-deterministic and
  prevents catalog review from being the source of rule behavior.
- **Resolve framework data from a live service during rule execution:** breaks air-gap operation
  and makes the evaluated catalog revision ambiguous.
