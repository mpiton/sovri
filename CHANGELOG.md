# Changelog

All notable changes to Sovri are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Each pull request that touches `.ts` / `.tsx` source code **must** add an entry to the
`[Unreleased]` section under the appropriate category. CI enforces this via the
`changelog-check` gate (see `docs/ARCHI.md` §15.3).

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

Scope of this changelog: the Community edition (`packages/*` + `apps/community-bot/`).
The proprietary Cloud edition (`apps/cloud-api/`) has its own internal changelog
(not published) starting at v0.5+.

---

## [Unreleased]

### Added

- `CLAUDE.md` — repository-wide agent instructions covering stack, ALWAYS/NEVER rules,
  architecture summary, commands, TDD workflow, conventional commits, supply-chain
  guardrails, and pointers to ARCHI §15/§16.
- `docs/ARCHI.md` §15 — full CI/CD pipeline specification (`backend-checks`, `knip`,
  `supply-chain`, `secrets-scan`, `forbidden-tools`, `forbidden-imports`,
  `build-docker`, `changelog-check`, `release.yml`, `codeql.yml`,
  `dependency-review.yml`, branch protection rules).
- `docs/ARCHI.md` §16 — Git hooks specification with `lefthook.yml` and helper
  scripts (`install-hooks.sh`, `no-secrets.sh`, `no-manual-deps.sh`,
  `no-forbidden-tools.sh`, `check-boundary.sh`).
- `docs/adr/011-oxlint-oxfmt.md` — ADR locking oxlint + oxfmt as the sole linter
  and formatter for TypeScript/JavaScript.
- `docs/adr/012-lefthook-ci-gates.md` — ADR locking lefthook as the local hook
  manager and the set of non-negotiable CI gates.
- `.claude/rules/` — modular Claude Code rules for the project (always-on context
  + path-scoped guidance for `packages/`, `apps/community-bot/`, `apps/cloud-api/`,
  tests, ADRs).

### Changed

- `docs/ARCHI.md` §2 — toolchain table extended with lint (oxlint), formatter
  (oxfmt), hook manager (lefthook), unused-code detector (knip), audit
  (`pnpm audit`), and SBOM (syft). Explicit rejection of ESLint, Prettier, Biome,
  husky, simple-git-hooks.
- `docs/ARCHI.md` §13 — ADR index extended with ADR-011 and ADR-012.
- `docs/ARCHI.md` §15 (was §15 Glossaire) — renumbered to §17 to make room for
  CI/CD (§15) and Git hooks (§16) sections.

---

## Release procedure

1. Move all entries from `[Unreleased]` into a new `## [vX.Y.Z] — YYYY-MM-DD`
   section. Keep an empty `[Unreleased]` section at the top with the six
   category headings for the next development cycle.
2. Verify that the version in every `packages/*/package.json` and
   `apps/community-bot/package.json` matches `vX.Y.Z`.
3. Tag the release: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`.
   The `release.yml` workflow takes over from there (build, sign, publish to
   GHCR and npm, attach SBOM and SLSA attestation).
