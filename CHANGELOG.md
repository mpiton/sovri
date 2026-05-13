# Changelog

All notable changes to Sovri are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Each pull request that touches `.ts` / `.tsx` source code **must** add an entry to the
`[Unreleased]` section under the appropriate category. CI enforces this via the
`changelog-check` gate.

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

Scope of this changelog: the Community edition (`packages/*` + `apps/community-bot/`).
The proprietary Cloud edition (`apps/cloud-api/`) has its own internal changelog
(not published) starting at v0.5+.

---

## [Unreleased]

### Added

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
  devDependencies. `.worktrees/` + `.claude/worktrees/` ignored from VCS.

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
