# ADR-028 — Framework catalog source metadata

**Status:** Accepted
**Date:** 2026-06-29

## Context

ADR-024 makes the `sovri-frameworks` Git repository the source of truth for framework catalogs.
MAT-83 adds strict YAML schemas for framework, control, rule, and mapping catalogs, so the source
metadata contract needs to be explicit before those schemas become the compliance-as-code input.

## Decision

Git is the source of truth for framework catalogs. Official source URLs and descriptions live in catalog files.
They do not live in prompt text, generated review output, engine code, or Cloud configuration. Catalog review owns changes to that source metadata through normal Git review before any rules engine consumes the catalog.

## Consequences

- Source provenance is reviewed with the catalog data that uses it.
- The rule engine can run from versioned catalog data without asking the LLM for official text or
  source metadata.
- The managed Cloud consumes published catalog versions and does not become an alternate source of
  truth for framework source metadata.

## Rejected alternatives

- **Generate official source descriptions from prompts:** mixes compliance provenance with LLM
  output and makes the source text non-reviewable.
- **Keep source metadata in engine code or Cloud configuration:** bypasses catalog review and
  creates a second source of truth.
