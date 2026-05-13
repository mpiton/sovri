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

- Pre-commit guard `scripts/check-boundary.sh` (#10) rejecting staged
  TypeScript files under `packages/` or `apps/community-bot/` that import
  from the proprietary `apps/cloud-api/` surface, enforcing the
  Community ↔ Cloud boundary per `docs/adr/010-licence-apache-2.md`. Two
  forbidden module specifiers are recognised: the reserved
  `@sovri/cloud...` workspace scope (any subpackage, single or double
  quote) and any relative climb `../...cloud-api...` that traverses into
  a `cloud-api` directory. The relative alternative requires a literal
  `../` prefix, so a local sibling import `./cloud-api-mock` inside
  `packages/` that merely embeds the substring is never flagged. Four
  import shapes are detected across both specifiers: single-line
  `import|export ... from "..."` (including `import type`, `export *`,
  `export type { X } from`), bare `from "..."` continuation line in
  multi-line destructured imports, side-effect `import "..."` (no
  `from`, ESM register pattern), and dynamic `import("...")` /
  `require("...")` calls. The first three shapes are anchored to
  start-of-line. The dynamic / CJS shape requires a statement-context
  boundary before the keyword — start of line, or an explicit
  punctuation whitelist `( , ; = ? : { } ! & | > [` optionally
  preceded by `await` / `return` / `yield` / `throw` / `new`. Bare
  whitespace, comment markers (`//`, `/*`, `*/`, `*`), and string
  delimiters (`"`, `'`, backtick) are deliberately NOT recognised as
  boundaries — that was the false-positive surface reported by the
  PR #73 review bots (CodeRabbit, Codex, cubic-dev-ai) where
  `// import("...")` and `/** import("...") */` previously tripped
  the gate. A second defense layer strips comments before grep
  (whole-line `//`, JSDoc body continuation `*`, inline `/* ... */`,
  trailing `//` preceded by whitespace) so commented-out example code
  embedding `import(...)` text never reaches the pattern matcher.
  `http://...` inside a string is preserved (the `//` is preceded by
  `:`, not whitespace). `coreImport(x)` / `myRequire(x)` identifier
  calls are not flagged either. Files outside the
  public surface (the `apps/cloud-api/` directory itself, other
  `apps/<name>/` workspaces, `scripts/`, root) are not scanned — the
  guard polices the import direction, not file names. Deletions are
  excluded via `--diff-filter=d`, so removing a legacy cloud importer
  passes. Staged contents are read from the index via `git show :<file>`
  rather than the working tree, so a partially staged file is evaluated
  as it will land in the commit; `git show` failure (e.g. race with
  `git restore --staged`) skips the file, an empty staged blob is
  scanned and passes naturally. Known limitations: (a) a dynamic import
  that splits `import(` and the quoted specifier across two physical
  lines slips through; (b) a multi-line `/* ... */` block whose body
  has no leading `*` continuation is not stripped (JSDoc convention
  always uses `*`); (c) an `import(...)` text inside a template literal
  preceded by a whitelisted punctuation char could match in
  pathological cases. The forthcoming pre-push `forbidden-imports`
  Turbo target (`ARCHI.md` §15.3) is the AST-aware enforcement; this
  pre-commit gate is a fast defense-in-depth layer that catches the
  common breaches in <50 ms. The error output names the violated ADR,
  enumerates each offending file plus the offending line with line
  number, and reminds contributors of the only permitted direction
  (`apps/cloud-api/` may import from `packages/*`, never the reverse).
  The relative-climb alternative requires a path-component boundary
  (`/` or the closing quote) after `cloud-api` so a local sibling
  `../cloud-api-mock` is not mistaken for a breach (PR #73 review,
  Codex). `+` and `-` are added to the dynamic punctuation whitelist
  so `"prefix" + import("...")` and `-import("...")` expression
  contexts are caught (PR #73 review, cubic-dev-ai).
  Companion `scripts/check-boundary.test.sh` runner exercises 37
  acceptance scenarios (16 PASS + 21 BLOCK) in isolated temporary git
  repositories with `commit.gpgsign=false`, covering each `@sovri/cloud`
  variant (bare scope, `-internals`, `-api`, single-quote, `.tsx`,
  multiple Apache 2.0 packages, `export * from` re-export,
  `import type`, `export type`), the multi-line `from` continuation,
  side-effect `import "..."`, dynamic `import("...")` and `require(...)`
  calls, each relative-climb depth (`../`, `../../`, `../../../`), the
  deletion case, the sibling `./cloud-api-mock` false-positive guard,
  the `@sovri/core` control case, a `.md` file that mentions the
  forbidden scope without being scanned, `apps/cloud-api/` itself, other
  `apps/<name>/` workspaces, the `scripts/` directory, a fixture string
  literal that embeds the forbidden specifier, a JSDoc/`//` comment that
  mentions it, a `coreImport`/`myRequire` similarly named identifier
  call, an empty placeholder `.ts` file, and a dedicated regression
  fixture for the PR #73 review feedback that combines whole-line and
  trailing `//` comments, inline `/* ... */`, JSDoc body continuation,
  and an escaped string literal — all referencing `import(...)` /
  `require(...)` as text and all expected to PASS. A second
  regression fixture covers the codex / cubic-dev-ai feedback
  (`../cloud-api-mock` parent-sibling import must pass, `"foo" +
  import("@sovri/cloud-api")` and `-import("@sovri/cloud-api")` must
  block). The empty-placeholder fixture now uses shell redirection
  to produce a genuinely zero-byte file (CodeRabbit). The "multiple breaches in
  one commit" scenario additionally asserts that every offending path
  and the `ADR-010` marker all appear in stdout, and a dedicated case
  asserts the `grep -n` line-number prefix (`3:import { X } from ...`)
  is preserved as a regression guard against dropping `-n`. Portable
  bash, no GNU-only flags, no Node.js dependency.
- Pre-commit guard `scripts/no-forbidden-tools.sh` (#9) rejecting staged files
  that introduce competing package managers or lint/format toolchains. Two
  regex families: foreign package-manager lockfiles (`package-lock.json`,
  `yarn.lock`, `bun.lockb`) per `docs/adr/002-monorepo-pnpm-turborepo.md`, and
  foreign lint/format configs (`.eslintrc*`, `biome.json*`, `.prettierrc*`,
  `.prettier.<suffix>`) per `docs/adr/011-oxlint-oxfmt.md`. Patterns are
  anchored to a path-component boundary, so the existing root `pnpm-lock.yaml`
  and nested workspace paths (`apps/x/...`, `packages/core/...`) are
  evaluated identically, and a markdown file whose name happens to contain
  `eslintrc` without the leading dot is not flagged. Deletions are excluded
  via `--diff-filter=d`, so removing a legacy forbidden file passes the
  guard. The error output enumerates every offending path, names the
  violated ADR, maps each forbidden family to its ADR-approved replacement
  (pnpm-lock.yaml, .oxlintrc.json, .oxfmtrc.json), and reminds contributors
  to use `pnpm add` so `pnpm-lock.yaml` is the only lockfile in the repo.
  Companion `scripts/no-forbidden-tools.test.sh` runner exercises 34
  acceptance scenarios (10 PASS + 24 BLOCK) in isolated temporary git
  repositories with `commit.gpgsign=false`, covering each lockfile family at
  root and nested paths, every documented ESLint legacy config extension
  (`.eslintrc`, `.json`, `.js`, `.cjs`, `.yaml`, `.yml`), both Biome
  filenames (`biome.json`, `biome.jsonc`), each Prettier rc and dotted
  variant (`.prettierrc`, `.prettierrc.json`, `.prettierrc.js`,
  `.prettierrc.yaml`, `.prettier.config.js`, `.prettier.ignore`), the
  positive cases for `pnpm-lock.yaml`, `package.json`, `.oxlintrc.json`,
  `.oxfmtrc.json`, `.npmrc` (`.npmrc` belongs to `no-secrets.sh`), files
  whose name embeds tool tokens but lacks the required path-component
  anchor, and the deletion case for an existing `.eslintrc.json`. The
  "multiple forbidden files in one commit" scenario additionally asserts
  that every offending path is listed in stdout, not only the BLOCKED
  header. Portable bash, no GNU-only flags, no Node.js dependency.

- Pre-commit guard `scripts/no-manual-deps.sh` (#8) rejecting commits that
  modify any `dependencies`, `devDependencies`, `peerDependencies`, or
  `optionalDependencies` block in a staged `package.json` (root or nested,
  e.g. `apps/x/package.json`) without staging the corresponding
  `pnpm-lock.yaml` update, forcing the use of
  `pnpm add` / `pnpm update` / `pnpm remove`. Edits limited to the
  `scripts`, `name`, `version`, or any other non-dependency field pass
  through unchanged, satisfying the issue #8 acceptance criterion that
  "editing only `scripts` field is allowed". The guard also rejects any
  staged `package-lock.json`, `yarn.lock`, or `bun.lockb` accompanying a
  `package.json` edit, per `docs/adr/002-monorepo-pnpm-turborepo.md` (pnpm
  is the only accepted package manager). Dependency-block comparison is
  performed by an inline `node -e` snippet that canonicalises and
  JSON-stringifies the four blocks read from `HEAD:<file>` and `:<file>`
  via `git show`, falling back to a fail-closed `"yes"` outcome if `node`
  is unavailable or errors — including on malformed `package.json` whose
  `JSON.parse` would otherwise be swallowed. Companion
  `scripts/no-manual-deps.test.sh` runner exercises 27 acceptance scenarios
  (12 PASS + 15 BLOCK) in isolated temporary git repositories, covering
  every dependency block, scripts-only edits, brand-new and deleted
  `package.json` files, nested workspace packages, version bumps,
  removals, malformed JSON, nested `pnpm-lock.yaml` bypass attempts,
  staged lockfile deletions, and each foreign lockfile family. The
  lockfile satisfaction check is pinned to the repository-root
  `pnpm-lock.yaml` (a nested `apps/x/pnpm-lock.yaml` does not satisfy
  it — pnpm workspaces use a single root lockfile per
  `docs/adr/002-monorepo-pnpm-turborepo.md`), and a staged
  `git rm pnpm-lock.yaml` is rejected via `git cat-file -e :pnpm-lock.yaml`
  so dependency edits cannot be combined with a lockfile deletion.
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
