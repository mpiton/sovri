# Sovri — Shared language

> Domain glossary and shared vocabulary for ATDD scenarios, reviewers, and contributors.
> Source documents: [PRD.md](./PRD.md), [ARCHI.md](./ARCHI.md), [docs/adr/](./docs/adr/).

## Core entities

- **Review** — automated PR analysis producing findings + walkthrough markdown comment.
- **Finding** — diff/code issue raised on a diff hunk: severity, category, location, rationale, and audit identity.
- **Walkthrough** — top-level PR comment summarising findings, grouped by severity.
- **Provider** — LLM backend adapter (Anthropic, Mistral, OpenAI, OAI-compatible). BYOK only.
- **Config** — `.sovri.yml` parsed by `@sovri/config`, governs review behavior per repo.

## Compliance Trail

- **Compliance Trail** — audit-oriented evidence layer that combines compliance references, a signed review trail, and future organisational learning.
- **Compliance Reference** — potential mapping from a finding to a technical, security, or regulatory framework reference.
- **ComplianceGap** — project-level compliance output for an unmet control or missing evidence.
- **Audit Trail** — tamper-evident chronological record of a review, intended for offline verification by an auditor.
- **Organisational Learning** — future capability that adapts review prioritisation from human accept/dismiss decisions without hiding findings in strict audit mode.
- project compliance scans evaluate Framework -> Control -> Rule -> Evidence.
- project compliance scan produces ComplianceGap output.
- PR review may project relevant compliance gaps into pull request output.

## Actors

- **Maintainer** — repo owner who installs the GitHub App, configures `.sovri.yml`.
- **Author** — opens the PR being reviewed.
- **Reviewer (human)** — reads bot output alongside their own review.
- **Bot** — `apps/community-bot`, the Probot service receiving webhooks.

## Distribution boundary

- **Community** — Apache 2.0, self-hosted, `packages/*` + `apps/community-bot/`.
- **Cloud** — Proprietary SaaS, `apps/cloud-api/` (v0.5+), imports packages, never reverse.

## Relationships

- A **Review** produces zero or more **Findings** and one **Walkthrough**.
- A **Finding** may have zero or more **Compliance References**.
- A **Compliance Trail** includes **Compliance References** and an **Audit Trail**.
- **Organisational Learning** may influence future review prioritisation, but **strict audit mode** keeps standard findings visible.
- **Community** owns the public review and compliance contracts; **Cloud** may add hosted operations but does not own review logic.

## Conventions

- All identifiers, code, log messages: English.
- Documentation may be French (legacy) or English (new).
- Schemas: Zod is the source of truth; TS types derive via `z.infer`.

## Flagged ambiguities

- Avoid **compliance violation** for automatic output. Use **Compliance Reference** because Sovri assists audit review and does not issue legal verdicts.
- Avoid `compliance_refs` in public contracts. Use `compliance_references`.
- Avoid using **strict** to mean both review style and audit guardrail. Use **strict audit mode** for the compliance guardrail.
