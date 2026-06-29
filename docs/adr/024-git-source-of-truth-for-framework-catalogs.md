# ADR-024 — Git as the source of truth for framework catalogs

**Status:** Accepted
**Date:** 2026-06-29

## Context

Compliance output is only as trustworthy as the regulatory text behind it. ADR-020 and ADR-022
already require that official framework text and source URLs come from versioned catalogs,
never from LLM output. MAT-113 turns that into an engineering requirement: the rule engine
consumes framework controls, rules, and references as data, and the air-gapped agent (ADR-023)
must hold that data locally before a scan runs.

We need one home for those catalogs, one format, and one provenance rule, fixed before the
`sovri-frameworks` repository (MAT-81) and the catalog schemas (MAT-83) are built.

## Decision

The `sovri-frameworks` Git repository is the source of truth for framework, control, and rule
catalogs. Catalogs are stored as structured YAML — `framework.yaml`, `control.yaml`, `rule.yaml`,
and `mapping.yaml` — under versioned catalog directories, so a catalog change is reviewed as a
versioned source update through normal Git review.

Framework references are backed by the catalog and source URLs are backed by the catalog: every
`FrameworkReference` carries the upstream framework version or publication date and an official
source URL drawn from a catalog entry. References and URLs are never authored by the LLM and
never hardcoded outside the catalog. The managed Cloud is never the source of truth; it consumes
published catalog versions like any other client.

## Consequences

- Provenance is auditable by construction: every regulatory citation traces to a catalog entry
  at a known version, which feeds the Compliance Trail (ADR-013).
- Catalog freshness is a review concern, not a runtime one: stale citations are refreshed during
  catalog update review before the engine consumes new framework text, keeping execution offline
  (ADR-023).
- Distributing catalogs through Git gives the air-gapped agent a local, versioned copy with no
  network fetch at scan time.
- A new framework is onboarded by adding catalog YAML under `sovri-frameworks`, not by changing
  engine code.

## Rejected alternatives

- **Let the LLM supply framework text or source URLs:** breaks source traceability and risks invented regulatory language. Rejected — framework references and source URLs must be catalog-backed.
- **Hardcode source URLs in the engine or fetch them from a live regulatory API:** couples citations to code or to network availability and bypasses versioned review. Rejected — the catalog, distributed through Git, is the source of truth.
- **Make the managed Cloud the catalog source of truth:** puts proprietary infrastructure on the provenance path for Apache-2.0 catalogs. Rejected — Git is the source of truth.
