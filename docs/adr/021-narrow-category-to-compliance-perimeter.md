# ADR-021 — Narrow the finding Category enum to the compliance perimeter

**Status:** Accepted
**Date:** 2026-06-25

## Context

The core finding `Category` enum (`packages/core/src/types/Finding.ts`) carried seven values:
`bug`, `security`, `performance`, `maintainability`, `style`, `documentation`, `test-coverage`.
It dates from when Sovri reviewed for general code quality.

Two later decisions changed the product's centre of gravity:

- ADR-013 made the compliance trail the primary differentiator, and the enrichment gate
  (`packages/review-engine/src/compliance-gate.ts`) only ever enriched `security` and `bug`
  findings. The other five categories never received a regulatory reference.
- MAT-75 made compliance-only the default publication behaviour: after enrichment, a finding
  with an empty `compliance_references` list is dropped before it reaches the pull request.

Together these mean a `performance` / `maintainability` / `style` / `documentation` /
`test-coverage` finding could never publish — it was ineligible for enrichment, so it always
carried an empty reference list, so MAT-75 always dropped it. The five categories were dead
surface in the public contract: they still appeared in the brand palette, the audit-reference
code table, the prompt directives, and the LLM/SARIF input schema, and the prompt actively asked
the model to spend effort on findings that could not survive the gate.

The pivot is to a pure-compliance review product. The taxonomy should describe that scope, not
the superseded code-quality one.

## Decision

Narrow `CategorySchema` to the compliance perimeter:

```
z.enum(["bug", "security", "compliance"])
```

- `bug` and `security` stay — they are the compliance-eligible defect classes (ADR-013, ADR-020).
- `compliance` is added for a finding that is itself a regulatory concern rather than a code
  defect (for example a missing data-retention or access-control requirement) and is not naturally
  a `bug` or a `security` weakness.
- `performance`, `maintainability`, `style`, `documentation`, `test-coverage` are removed.

Everything that derives from the enum moves in lockstep:

- `compliance-gate.ts` drops its category-based eligibility check: every category in the narrowed
  enum is compliance-eligible, so `shouldEnrichCompliance` now gates on confidence alone. A finding
  is withheld only when its confidence is below `COMPLIANCE_MIN_CONFIDENCE` or, after enrichment,
  its CWE maps to no framework.
- `@sovri/brand` category palette and the `audit-ref` two-letter code table keep `bug`/`security`
  and add `compliance` (`CP`); the dropped entries go. This honours the exhaustiveness coupling
  in ADR-015 and ADR-016.
- The review prompt directives (`prompt/builder.ts`) stop soliciting performance / maintainability
  / style findings and ask for bug, security, and compliance findings only.
- The two synthetic `review_failed` sentinel findings (orchestrator, retry) move from
  `maintainability` / `documentation` to `bug`.

### Backward compatibility

No stored-finding migration is required:

- The bot is stateless; it persists no findings.
- Finding reconciliation across review runs keys on a content fingerprint that deliberately
  excludes `category` (bug-2591 R-04), so a previously posted comment whose finding was a now-removed
  category is still matched by fingerprint and is never re-parsed back through the narrowed enum.

The remaining parse surfaces are inputs: `FindingSchema` and `ProviderFindingSchema`. After the
change they reject a removed value. For LLM output this is intended — the prompt no longer asks for
those categories, and the existing retry / synthetic-failure path already handles a non-conforming
response. This supersedes the task-90 R-06 assertion that the category domain is unchanged.

## Rationale

- The contract now matches behaviour. A value that can never publish should not be in the public
  enum, and removing it stops the prompt from spending model budget on unpublishable findings.
- Adding `compliance` as a first-class category lets the engine label a finding whose primary nature
  is regulatory, instead of forcing it into `bug`/`security`.
- The smaller enum tightens the model's instruction surface and the brand/audit-code exhaustiveness
  guards, both of which were already coupled to the enum.

## Consequences

- This is a public `@sovri/core` contract change: the `Finding` type is part of the published
  package API. A downstream consumer that branches on a removed category value must update to treat
  it as `bug`; the changelog records the removal as a breaking change.
- The brand palette, audit-code table, badge vocabulary, and the exhaustiveness tests that asserted
  seven values are updated to three. This updates the seven-value framing in ADR-015 / ADR-016.
- A `compliance` finding still publishes only when it carries a mapped `compliance_reference`
  (MAT-75). Enrichment derives references from a CWE (ADR-020), and a compliance finding may have no
  natural CWE; deriving references for the `compliance` category from non-CWE signals is left to a
  follow-up that extends ADR-020's derivation rules. Until then a `compliance` finding without a
  mapped reference is dropped by the gate like any other.
