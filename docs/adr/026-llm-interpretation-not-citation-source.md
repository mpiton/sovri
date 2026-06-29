# ADR-026 — LLM limited to interpretation and ranking, not a citation source

**Status:** Accepted
**Date:** 2026-06-29

## Context

Sovri's review surface uses an LLM, and the deterministic compliance derivation in ADR-020
deliberately keeps regulatory citations off the model's critical path: a wrong GDPR or DORA
citation is worse than none. ADR-022 rejected letting the LLM provide framework text because it
breaks source traceability and risks invented regulatory language. MAT-113's project compliance
engine raises the stakes — control evaluation and gaps must be defensible to a regulator.

The LLM's role across the agent and the review path therefore needs to be fixed so the product
cannot drift back to LLM-authored regulatory claims.

## Decision

The LLM role is interpretation and ranking only. It may summarise, prioritise, and explain gaps
and findings in natural language, but the LLM is not an official citation source. Regulatory
claims must be catalog-backed, not LLM-authored: framework text, control definitions, and source
URLs come from the catalog (ADR-024), and the deterministic engine (ADR-020 and ADR-023) decides
whether a control passes or a gap exists.

## Consequences

- A model error can change wording or ordering but cannot invent a regulatory citation or flip a
  control result, which bounds the blast radius of a bad LLM response.
- Interpretation and ranking can stay on the network or Cloud side without touching the
  air-gapped deterministic core (ADR-023).
- The same rule holds for PR review: the LLM ranks and explains, while the catalog and engine own
  the regulatory substance.

## Rejected alternatives

- **Let the LLM be the source of regulatory citations:** reintroduces invented citations and breaks traceability. Rejected — the LLM must not be an official citation source.
- **Let the LLM author regulatory claims when the catalog is incomplete:** trades correctness for coverage on exactly the claims that must be defensible. Rejected — regulatory claims must be catalog-backed, not LLM-authored.
