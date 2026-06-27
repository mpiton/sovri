# ADR-021 — Compliance-only review taxonomy and prompt

**Status:** Accepted
**Date:** 2026-06-24

## Context

ADR-013 made the Compliance Trail Sovri's primary differentiator: a finding earns
its place by anchoring to a regulatory framework through a CWE, not by being a
generic code-review remark. MAT-75 enforced that at the output boundary with a
compliance-only publication gate — after enrichment, any finding left with an
empty `compliance_references` is dropped before it reaches the pull request.

Two layers still contradicted that positioning:

- The review **prompt** kept soliciting generic defects. All four modes asked for
  "bugs, security, performance, real design or maintainability problems", and the
  shared CWE directive carried an explicit "omit `cwe` on style or performance
  findings" escape hatch. The model spent tokens and attention producing findings
  the gate then discarded, and the only signal it received was that non-compliance
  review was wanted.
- The **taxonomy** still advertised generic review. `CategorySchema` in
  `@sovri/core` carried seven values (`bug`, `security`, `performance`,
  `maintainability`, `style`, `documentation`, `test-coverage`), of which only
  `security` and `bug` are compliance-eligible (the gate allowlist, ADR-013/020).
  The other five could only ever produce findings the gate dropped, yet the public
  Apache 2.0 contract presented them as first-class.

For the target audience — regulated EU enterprises adopting Sovri precisely
because it is compliance-first — that mismatch is a positioning and a noise
problem: the product claims a focused scope but behaves like a general linter that
quietly throws most of its own output away.

## Decision

Make compliance-only the taxonomy and the prompt, not just the publication gate.

- Trim `CategorySchema` to exactly the compliance-eligible set: `"bug"` and
  `"security"`. The parsing schemas (`LLMRawFinding`, `ProviderFinding`) reference
  `CategorySchema`, so a model finding tagged with a removed category is now
  rejected at the parse boundary — noise is stopped before enrichment, not merely
  dropped after it. `@sovri/brand`'s category palette and the audit-reference
  category-code table are reduced to the same two keys.
- Rewrite all four review modes (`full`, `bugs-only`, `strict`, `minimal`) to
  solicit only security and correctness weaknesses that map to a known CWE. Each
  mode keeps its volume/severity character (e.g. `minimal` still caps at three
  blocker/major findings) but no longer asks for style, performance, or
  maintainability review.
- Make the shared CWE directive unconditional: every finding should carry a `cwe`,
  dropping the "omit on style or performance findings" clause, which referenced
  categories that no longer exist.
- Keep non-CWE `ComplianceGap` output separate from the CWE-backed `Finding`
  path. `ComplianceGap` remains project-level output from control/evidence
  checks, not part of the PR review taxonomy.

The compliance gate's eligibility allowlist (`{security, bug}`) is kept. It now
mirrors the whole enum, so it is a no-op in practice but remains as defense in
depth should a non-compliance category ever be reintroduced.

## Rationale

- Stopping noise at the prompt and parse boundary is strictly better than
  generating then dropping it: it saves model effort, removes a class of
  enriched-then-discarded findings, and makes the contract say what the product
  does.
- Aligning the public `Category` enum with the gate's eligibility set removes a
  standing inconsistency between what callers can express and what Sovri will ever
  publish.
- Keeping `bug` (not only `security`) preserves CWE-mappable correctness
  weaknesses — a null-deref or integer-overflow defect maps to a CWE and carries
  real regulatory weight — so the pivot narrows scope without losing compliance
  signal.

## Consequences

- **Breaking public contract change.** `CategorySchema` / `Category` in
  `@sovri/core` drops five values. Any consumer that persists or switches on the
  removed category strings must migrate. Captured in `CHANGELOG.md` under
  `Removed` for the next release.
- A finding the model tags with a removed category no longer round-trips as an
  unmapped finding; it fails schema validation, takes the existing retry path, and
  surfaces a synthetic `review_failed` finding if the model keeps returning an
  invalid category. This is the same mechanism as any other malformed response.
- The pre-pivot acceptance tests for "a non-eligible category is dropped by the
  gate / declines derivation" are removed: that behaviour is now enforced one
  layer earlier, at the schema, and is covered by the parsing contract tests.
- The eligibility allowlist is retained but currently equals the full enum; if a
  future category is added it must be a deliberate decision about both the
  taxonomy and the gate.

## Rejected alternatives

- **Prompt-only change, keep the seven-value enum:** would leave the public
  contract advertising generic review and keep the door open to unmapped findings
  the gate silently drops — the mismatch this ADR exists to close.
- **Remove `bug` too, keep only `security`:** discards CWE-mappable correctness
  weaknesses that carry genuine regulatory weight, narrowing scope further than
  the compliance mapping requires.
- **Drop the gate's category allowlist now that the enum matches it:** removes a
  cheap defense-in-depth guard for no benefit; reintroducing a category later
  would silently re-open enrichment to it.
