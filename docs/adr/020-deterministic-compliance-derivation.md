# ADR-020 — Deterministic compliance derivation

**Status:** Accepted
**Date:** 2026-06-19

## Context

ADR-013 made compliance enrichment deterministic: the model may volunteer a CWE, Sovri maps that CWE to framework references from local data, and automatic output is `applicable_if` / `informational`, never `confirmed`. The enrichment gate (`packages/review-engine/src/compliance-gate.ts`) emits a reference only when the finding category is `security` or `bug`, the model supplied a `cwe` that is one of the mapped ids, and confidence is at least `COMPLIANCE_MIN_CONFIDENCE` (0.7). The enricher (`packages/compliance/src/mapping/enricher.ts`) returns an empty list whenever `cwe` is undefined.

The consequence is that compliance coverage depends entirely on the model volunteering a precise CWE. For a product whose primary differentiator is regulated-enterprise compliance review (ADR-013), "the model usually remembers the CWE" is not a guarantee. The sibling probabilistic fixes (#2607 prompt elicitation, #2608 schema defaults, #2609 Mistral strict-schema parity) raise the odds the model returns a CWE but cannot guarantee it; a security finding the model reported without a CWE silently loses its framework reference.

For the target audience a wrong GDPR/DORA citation is worse than none, so any reference emitted without a model CWE must clear a high precision bar.

## Decision

Add a pure, deterministic derivation layer in `@sovri/compliance` that recovers a mapped CWE from a finding's own signals when the model omitted one.

When a finding is compliance-eligible (category `security` or `bug` and confidence ≥ `COMPLIANCE_MIN_CONFIDENCE`) but carries no `cwe`, derive a candidate mapped CWE from the finding's signals — category, title/body keywords, and affected APIs. If derivation resolves to exactly one mapped CWE, enrich from that CWE's local references; the references stay `applicable_if` / `informational` and are never `confirmed`, unchanged from ADR-013. If derivation is ambiguous — zero candidates, or more than one — or the finding is ineligible, no reference is emitted.

Derivation:

- **never** overrides or alters a model-supplied `cwe`; it only fills the `cwe === undefined` path, so findings that already carry a CWE behave exactly as today.
- adds **no second LLM call**: it is an offline signal → mapped-CWE → references computation, reproducible and unit-testable.
- targets only the already-mapped CWE id set (ADR-013 coverage). A derived CWE that is not in the local map yields no reference, exactly like a model-supplied unmapped CWE.
- ships a small, high-precision rule set first (raw SQL string concatenation → CWE-89; unescaped user input rendered into HTML → CWE-79) and grows only by adding rules that map unambiguously.

A derived reference carries the same informational `applicable_if` flagging as every other automatic reference, so no new field on the pure `@sovri/core` finding shape is required for this layer. Recording the derivation source as provenance for auditors is a possible later refinement that would reuse the optional walkthrough provenance field (ADR-017); it is out of scope here.

## Rationale

- Precision over recall is the only safe default for regulatory citations: declining on ambiguous content keeps false attributions out, which matters more to auditors than catching every case.
- Determinism preserves what ADR-013 bought — offline, testable, auditable behavior — instead of reintroducing the LLM-hallucination surface a second model call would open.
- Keeping the deriver in `@sovri/compliance` respects the layering: `@sovri/core` stays a pure domain, and the package that already owns the CWE map also owns the signal→CWE rules and their versioned data.
- Treating derivation as a fallback (not a rewrite) makes the no-regression guarantee structural: the model-CWE path never reaches the deriver.

## Consequences

- `@sovri/compliance` gains a pure derivation module; the review-engine gate keeps its eligibility role and the enricher consults the deriver only on the no-`cwe` path. `@sovri/core` is unchanged.
- Findings with a model CWE are unchanged (no regression); derivation only adds references where there were none.
- Coverage is intentionally narrow and precision-first: only unambiguous rules ship, ambiguous content declines, and recall grows rule by rule, each justified and tested.
- The derivation rules become an auditable, versioned part of the Apache 2.0 compliance package, consistent with ADR-013's auditable-mapping stance.
- Risk: a rule that is too loose could attach a wrong reference. Mitigation: unambiguous-only rules, the existing confidence floor, decline-by-default, and a test per rule.

## Rejected alternatives

- **Relax the gate to emit references for any eligible no-CWE finding** (issue #2610 option b): would attach references to vague findings with no identifiable vulnerability class — exactly the false-citation risk the target audience cannot tolerate.
- **A second LLM call to recover the CWE**: non-deterministic, adds latency and cost on the hot path, and reopens the hallucination surface ADR-013 closed.
- **Broad keyword tables for maximum recall**: maximizes coverage but trades away precision; a wrong GDPR/DORA citation is worse than none.
- **Mark derived references `confirmed`**: violates ADR-013 — automatic output is never `confirmed`.
- **Put the deriver in `@sovri/core`**: core is a pure domain; the signal heuristics and mapping data belong in `@sovri/compliance`, which already owns the CWE map.
