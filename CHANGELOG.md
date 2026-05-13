# Changelog

All notable changes to Sovri are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Each pull request that touches `.ts` / `.tsx` source code **must** add an entry
to the `[Unreleased]` section under the appropriate category. The planned
`changelog-check` CI gate will enforce this once CI wiring lands.

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

Scope of this changelog: the Community edition (`packages/*` + `apps/community-bot/`).
The proprietary Cloud edition (`apps/cloud-api/`) has its own internal changelog
(not published) starting at v0.5+.

---

## [Unreleased]

### Added

- Pre-commit guard `scripts/no-secrets.sh` (#7) rejecting staged files that
  match known secret-file patterns (`.env`, `.env.<suffix>` except
  `.env.example`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.secret`, `*.creds`,
  `*.aws` including the `.aws/credentials` path, `.netrc`, `.npmrc`,
  `.pypirc`) and scanning the staged diff for seven API-key prefixes
  (AWS `AKIA`, Anthropic `sk-ant-`, generic `sk-` permitting `_` and `-`
  in the body to cover `sk-proj-` and `sk-svcacct-` keys, GitHub `ghp_` and
  `github_pat_`, GitLab `glpat-`, Google `AIza`). Content matching is
  case-sensitive on purpose — the prefixes are canonical case — and every
  `pnpm-lock.yaml` and `package.json` across the monorepo is excluded from
  the content scan to avoid false positives on lockfile integrity hashes,
  in line with the local-hook / CI reciprocity rule from
  `docs/adr/012-lefthook-ci-gates.md`. Portable bash, no GNU-only flags,
  no Node.js dependency. Companion `scripts/no-secrets.test.sh` runner
  exercises 34 acceptance scenarios in isolated temporary git
  repositories.
- Repository plumbing (#6): `.github/dependabot.yml` enabling weekly
  Dependabot updates for the npm (pnpm-workspace), Docker and GitHub Actions
  ecosystems, with `cooldown.default-days: 7` on each ecosystem (the
  per-semver overrides inherit this default, so every version-update PR
  waits at least 7 days before opening) to satisfy the project's
  supply-chain delay rule; pull request template enriched with a
  `## Why` section between Summary and Changes and an explicit
  `CHANGELOG.md updated under [Unreleased]` checkbox in the contributor
  checklist.
- Community health files (#5): root `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, and `CHANGELOG.md` covering contribution workflow,
  conduct expectations and release history, with README and `.github`
  contribution links pointing at the canonical root guide.
- Public-facing documentation (#4): root `README.md` covering the project
  tagline, EU sovereignty positioning, Apache 2.0 + proprietary Cloud
  distribution boundary, current pre-alpha status, build-from-source steps,
  planned bot delivery channels (GHCR image + standalone Node process), and
  links to the ADRs, contributing guide, security policy, changelog and
  pricing. Explicit disclaimer that no certification (ISO 27001, SOC 2, HDS,
  SecNumCloud) is claimed today. `.github/SECURITY.md` enriched with an
  explicit in-scope list (auth bypass, credential leakage, supply-chain
  compromise, sandbox escape, Apache 2.0 / Cloud boundary breach), an
  explicit Out-of-Scope list (hardening suggestions without exploit path,
  patched third-party CVEs, unrealistic-volume DoS, attacks outside the
  threat model, social engineering, Cloud edition, unsupported
  configurations), and a PGP fingerprint placeholder to be published before
  v0.1.
- `docs/adr/001..012` — initial set of Architecture Decision Records covering
  the locked toolchain: Node.js LTS 24 + strict TypeScript, pnpm + Turborepo
  monorepo, ESM-only modules, Probot, Zod runtime validation, Pino logger,
  Vitest + MSW testing, tsup bundling, multi-stage Docker on GHCR,
  Apache 2.0 licensing of the Community edition, oxlint + oxfmt for lint and
  format, and lefthook + non-negotiable CI gates.
- Monorepo root bootstrap (#1): root `package.json` (`"type": "module"`,
  `"private": true`, `packageManager: pnpm@10.33.2`, Node 24 LTS engines),
  `.nvmrc` pinning Node `24.11.1`, `.npmrc` with `ignore-scripts=true` +
  `engine-strict=true` + `auto-install-peers=true` + `save-exact=true` +
  `strict-peer-dependencies=true`, `.gitignore` covering build artifacts,
  caches, env files, credentials and foreign lockfiles, and `.gitattributes`
  enforcing LF line endings on text files.
- Workspace pipelines (#2): `pnpm-workspace.yaml` declaring `packages/*` and
  `apps/*`, `turbo.json` with cached `build`/`test`/`lint`/`typecheck` tasks
  (`^build` dependency for build/test/typecheck), `tsconfig.base.json` shared
  by every package (`strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `target: ES2023`,
  `module: NodeNext`), root scripts `build` / `test` / `lint` / `typecheck`
  delegating to Turborepo, and `turbo@2.9.12` + `typescript@5.9.3` pinned as
  root devDependencies.
- Lint, format and dead-code toolchain (#3): `.oxlintrc.json` enabling the
  `typescript`, `unicorn`, `oxc` and `import` plugins with `correctness` and
  `suspicious` categories at `error`, hard bans on `any`
  (`typescript/no-explicit-any`), `@ts-ignore` and `@ts-expect-error`
  (`typescript/ban-ts-comment`), `!` non-null assertions and loose equality;
  test files override relaxes non-null and `no-console`. `.oxfmtrc.json` at
  root with default formatting and ignore patterns for build outputs, caches,
  worktrees, `pnpm-lock.yaml` and `CHANGELOG.md`. `knip.json` declaring the
  monorepo workspaces, production-only entries for `packages/*` and `apps/*`
  (`src/{index,cli,bin,server,worker}.ts`), and `ignoreExportsUsedInFile` to
  match the bundle granularity. Root scripts `lint`
  (`oxlint . --max-warnings=0 --no-error-on-unmatched-pattern`, matches the
  ADR-011 CI gate while tolerating an empty TypeScript repo on v0.1),
  `lint:fix`, `format`, `format:check` and `knip` (`--reporter compact`).
  `oxlint@1.64.0`, `oxfmt@0.49.0` and `knip@6.13.1` pinned as root
  devDependencies. Local worktree directories ignored from VCS.

### Changed

### Deprecated

### Removed

### Fixed

### Security

- Enforced a 7-day cooldown before any Dependabot version-update pull
  request is opened (#6), mitigating the supply-chain timing window for
  compromised packages highlighted by the May 2026 mini-shai-hulud
  incident (TanStack, Mistral SDK and OpenSearch compromised). Note that
  Dependabot security-update PRs bypass cooldown by design; merge-time
  review remains enforced by branch protection and human approval.

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
