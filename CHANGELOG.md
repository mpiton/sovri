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

- Minimal root `tsconfig.json` (#14) extending `tsconfig.base.json`
  with `files: []` and `references: []`. Acts as a placeholder
  aggregator so `pnpm exec tsc -b --noEmit` invoked by the
  `ts-typecheck` pre-commit hook exits `0` in the walking-skeleton
  state. Without it, `tsc -b` looks for a root project file, falls
  back through `tsconfig.base.json` resolution, and emits `TS5083:
  Cannot read file '.../tsconfig.json'` the first time a contributor
  stages a `.ts` file in a subdirectory after this PR lands. Each
  package init task (#21, #24, #27, #31, #39) will extend this file by
  appending a `{ "path": "<package>" }` entry to `references` as its
  `tsconfig.json` lands, so the root file evolves into the real
  project graph without further migration.
- `lefthook.yml` pre-commit wiring (#14) — single source of truth for
  local Git hooks at the repo root, matching the spec in `ARCHI.md`
  §16.1 and the ADR-012 reciprocity rule (every CI gate has a matching
  local hook). Pre-commit declares eight commands running in parallel —
  `ts-lint` (`pnpm exec oxlint --no-error-on-unmatched-pattern
  {staged_files}`), `ts-format` (`pnpm exec oxfmt --check
  --no-error-on-unmatched-pattern {staged_files}`), `ts-typecheck`
  (`pnpm exec tsc -b --noEmit`), `no-secrets`, `no-manual-deps`,
  `no-forbidden-tools`, `boundary-community-cloud`, and an inline
  `changelog-updated` snippet that blocks any staged `.ts`/`.tsx` diff
  unless `CHANGELOG.md` is staged in the same commit. Hooks that depend
  on a working tree state (`ts-lint`, `ts-format`, `ts-typecheck`,
  `boundary-community-cloud`, `changelog-updated`) declare
  `skip: [merge, rebase]` so merge / rebase commits are not blocked by
  intermediate states; the guards that scan the index itself
  (`no-secrets`, `no-manual-deps`, `no-forbidden-tools`) run on every
  commit. Each command carries an actionable `fail_text` pointing at the
  exact recovery command. The configuration is loaded by the
  `pnpm exec lefthook install` invocation already wired into
  `scripts/install-hooks.sh` (#13), so an onboarding contributor running
  the installer immediately picks up the new hook set. `lefthook@2.1.6`
  is added to the root workspace as a `devDependency` via
  `pnpm add -D -w lefthook` so `pnpm exec lefthook` resolves the binary
  deterministically against the locked version rather than a
  globally-installed copy. Note: `ARCHI.md` §16.1 was authored against
  the lefthook 1.x line; lefthook 2.x ships the same YAML schema for
  the keys we use (`parallel`, `commands`, `run`, `glob`, `skip`,
  `fail_text`, `{staged_files}`), so the §16.1 spec is reproduced
  verbatim and no §16 amendment is required. The pre-push block
  specified in `ARCHI.md` §16.1 (`vitest run`, `tsc -b` project build,
  `pnpm audit`, `pnpm dedupe --check`, `knip`, `turbo build packages`)
  is intentionally deferred to a follow-up issue because it depends on
  the TypeScript workspace setup (root `tsconfig.json` with project
  references, `vitest` devDep, populated `packages/`) which does not
  exist in the walking-skeleton state at the time this file lands; the
  ADR-012 reciprocity guarantee will be restored once both the
  pre-push wiring and the matching CI workflows (`backend-checks`,
  `secrets-scan`, `forbidden-tools`, `forbidden-imports`,
  `supply-chain`, `changelog-check`) ship in dedicated PRs.
- Smoke test `scripts/lefthook.test.sh` (#14) — bash runner that asserts
  the declared shape of `lefthook.yml` against issue #14 acceptance
  criteria without depending on Vitest. The test fetches a normalised
  view of the configuration via `pnpm exec lefthook dump`, then asserts:
  the `pre-commit` block declares `parallel: true`; all eight required
  `pre-commit` commands are present; every `pre-commit` command carries
  a `fail_text` field; `skip: [merge, rebase]` is declared on the five
  commands that need it; `ts-lint` and `ts-format` thread
  `{staged_files}` into their `run:` line; and the `pre-push` block is
  intentionally absent (its wiring is deferred to a follow-up issue, so
  a partial accidental restoration must trip the test). Two functional
  cases cover the acceptance criteria the declarative checks cannot
  reach on their own — `oxlint` is invoked directly against a temp `.ts`
  file containing an `any` annotation to confirm that
  `typescript/no-explicit-any` is set to `error` in `.oxlintrc.json`
  (the `ts-lint` hook would surface the same exit code), and the inline
  `changelog-updated` snippet from `lefthook.yml` is replayed inside an
  isolated `mktemp -d` git repo across three sub-cases: a staged `.ts`
  file with no `CHANGELOG.md` staged (expects exit `1` plus the
  `Code modified without CHANGELOG.md entry` message), the same with
  `CHANGELOG.md` also staged (expects exit `0`), and a docs-only commit
  staging just `CHANGELOG.md` (expects exit `0`) so the inverse path
  cannot wrongly block docs-only diffs. Exit codes follow the project
  convention shared with the other `scripts/` guards: `0` on full pass,
  `1` on a policy / spec deviation with the failing assertions listed
  on stderr, `2` on an infrastructure error (missing `git`/`pnpm`/
  `node`, missing `lefthook.yml`, or `mktemp` failure).
- License allowlist gate `scripts/check-licenses.mjs` (#12) — Node ESM
  script intended to be invoked by the `supply-chain` CI job after
  `pnpm audit --audit-level=high`, mirroring the `allow-licenses` /
  `deny-licenses` arguments of the `dependency-review-action` step so
  the same policy is enforced inside the workflow (where
  `dependency-review-action` only runs on pull requests) as on the
  default branch. This change ships the script and its test runner
  only; no `.github/workflows/` files are modified. Reads
  `pnpm licenses list --json` (or a pre-captured JSON file via the
  `--input <path>` escape hatch the test harness uses), enumerates
  every direct + transitive dependency, classifies each bucket key
  against the allowlist (`Apache-2.0`, `MIT`, `BSD-2-Clause`,
  `BSD-3-Clause`, `ISC`, `MPL-2.0`, `CC0-1.0`, `Unlicense`,
  `BlueOak-1.0.0`) and the deny-list (every `AGPL-1.0/3.0-only`,
  `AGPL-1.0/3.0-or-later`, `GPL-2.0/3.0-only`, `GPL-2.0/3.0-or-later`,
  `LGPL-2.0/2.1/3.0-only` and `LGPL-2.0/2.1/3.0-or-later` SPDX
  identifier), and exits non-zero on the first deny match. Contract is
  `node scripts/check-licenses.mjs [--input <pnpm-licenses-list.json>]`.
  Exit codes follow the convention shared with the other `scripts/`
  guards: `0` on success with a one-line
  `OK: N package(s) across M license bucket(s) — all on allowlist`
  written to stderr (or `OK: pnpm reported no packages to audit` when
  the input is the plain-text `No licenses in packages found` sentinel
  that pnpm emits with `--prod` on an empty install — vacuous pass,
  there is nothing to audit), `1` on a violation with a `BLOCKED:`
  stderr message naming the offender count, the allowlist, the denied
  family, then per-package the name, version, license bucket, reason
  for denial and install path (issue #12 acceptance: "reports
  offending packages with their license + path"), and `2` on an
  infrastructure error (`pnpm licenses list --json` spawn failure or
  non-zero exit, unreadable `--input` target, malformed JSON, `null`
  or array root, a bucket value that is not an array, unknown CLI
  flag, or `--input` with no path argument). The SPDX-expression
  evaluator handles the subset of SPDX 2.3 Annex D syntax that
  `pnpm licenses list` can plausibly emit — single SPDX identifiers,
  `OR` (any allowed branch satisfies — §D.5 recipient-picks-one
  semantics so `(MIT OR GPL-2.0-only)` passes the gate by selecting
  MIT), `AND` (every branch must be allowed — §D.6 simultaneous
  compliance so `MIT AND GPL-2.0-only` is denied), parenthesised
  grouping (nested groups parsed recursively), `WITH` (exception
  identifier consumed but ignored — exceptions modify allocation
  terms, not the allowlist decision so `Apache-2.0 WITH LLVM-exception`
  passes on the `Apache-2.0` atom), and the legacy `+` suffix from
  SPDX 2.0 ("or any later version" — kept on the atom for denylist
  matching so a stale `LGPL-2.1+` declaration still trips the
  copyleft family guard even though SPDX 2.3 deprecated the operator
  in favour of `-or-later`). The evaluator falls closed on anything
  it cannot parse: an unrecognised token, an unbalanced parenthesis,
  a dangling `WITH`, or trailing tokens after the expression all
  yield a "cannot parse" denial rather than a vacuous pass. A
  `collectParseFailure` walker traverses the full tree after the
  parser returns so an OR short-circuit on a satisfied left branch
  cannot hide a malformed right branch (`MIT OR <truncated>`
  denies even though MIT alone would have satisfied — the header's
  fail-closed promise is preserved end to end). Non-SPDX
  free-form license strings (`Unknown`, `UNLICENSED`,
  `SEE LICENSE IN <file>`, `Custom`, `UNDEFINED`) are denied
  outright because compliance review cannot proceed without a
  canonical identifier. A separate `COPYLEFT_FAMILY` regex catches
  any `A?GPL` or `LGPL` prefix (case-insensitive, anchored at the
  start of the string with no trailing word boundary so non-canonical
  declarations such as `GPLv2`, `GPLv3`, `LGPLv3`, `GPL2`, `GPL3` and
  `GPL-2.0-with-classpath-exception` are denied — older npm packages
  predating SPDX 2.0 ship these forms and the `\b` variant of the
  regex would let them slip past the family safety net). No
  permissive identifier in the allowlist starts with the GPL/AGPL/LGPL
  letters, so dropping the trailing word boundary is safe as defense
  in depth even if the explicit allowlist is later edited. Per-entry
  license fields are also classified against the bucket key so a
  hypothetical pnpm misgrouping (entry's declared `license` disagrees
  with the bucket it lives in) cannot smuggle a denied package
  through; verdicts are memoised so a workspace with thousands of MIT
  packages classifies each unique license string exactly once. No runtime dependencies — `node:fs` + `node:child_process`
  (for `spawnSync` on the no-argument form) + `node:process` only,
  ESM via `.mjs`, runs on the Node 24 pinned in `.nvmrc`. Companion
  `scripts/check-licenses.test.sh` runner exercises 41 acceptance
  scenarios in isolated `mktemp -d` directories with synthetic
  pnpm-licenses JSON fixtures: twelve PASS cases (single MIT
  bucket; multiple allowed buckets aggregated; every allowlist
  licence as a singleton bucket — covering the count of "9 license
  bucket(s)"; `(MIT OR Apache-2.0)` dual licence; `MIT OR
  GPL-2.0-only` OR-picks-allowed-branch; `MIT AND BSD-3-Clause`
  AND-with-two-allowed-atoms; `Apache-2.0 WITH LLVM-exception`
  WITH-exception ignored on the allowed atom; nested parentheses
  `(MIT AND (Apache-2.0 OR BSD-3-Clause))`; empty JSON object;
  `No licenses in packages found` plain-text sentinel; empty file
  treated as no packages; `Apache-2.0 WITH Classpath-exception-2.0`
  honours the SPDX-registered exception list and passes on the
  `Apache-2.0` atom), twenty FAIL cases (`GPL-3.0-only`,
  `AGPL-3.0-or-later`, `LGPL-2.1-only`, legacy `LGPL-2.1+` suffix,
  `MIT AND GPL-2.0-only` AND-with-one-denied-branch,
  `GPL-2.0-only OR AGPL-3.0-only` OR-with-no-allowed-branch,
  `Unknown`, `UNLICENSED`, `SEE LICENSE IN LICENSE.md`, a valid SPDX
  identifier `OFL-1.1` that is simply not on the allowlist, a
  metadata-completeness regression asserting the BLOCKED message
  exposes `evil-pkg@1.2.3` + `license: GPL-2.0-only` +
  `path   : /store/evil-pkg`, and a mixed bucket where two MIT
  packages pass alongside a denied `GPL-3.0-or-later` package so
  only the denied entry is counted in `BLOCKED: 1 package(s)`;
  non-canonical `GPLv2` denied as copyleft family via the
  no-word-boundary regex; same for `LGPLv3` and `GPL3` short forms;
  a defense-in-depth case where the bucket key is `MIT` but an entry
  declares `license: GPL-3.0-only` — the per-entry classification
  surfaces the disagreement and denies with reason
  `entry license disagrees with bucket`; trailing `MIT OR` denied as
  a parse error so the OR short-circuit cannot hide a malformed
  right branch; unbalanced `(MIT` denied as a parse error;
  `MIT WITH totally-made-up` denied with reason
  `unknown SPDX exception after WITH` — the parser now validates the
  exception token against the SPDX exceptions allowlist instead of
  stripping any token blindly, closing a bypass where a malformed
  WITH clause would pass as the bare licence atom — and
  `MIT WITH OR` similarly denied because the operator collides with
  what would have to be an exception identifier),
  and seven ERROR cases (invalid JSON, `null` root, array root,
  bucket value that is not an array, missing `--input` target,
  `--input` with no path argument, and an unknown `--bogus`
  flag rejected), and two SPAWN-mode regression cases that shadow a
  fake `pnpm` on the PATH to exercise the `spawnSync` branch the
  `--input` cases cannot reach — one where the fake pnpm self-signals
  with SIGTERM (asserting the gate refuses to claim a vacuous pass
  when `status === null` and `signal !== null`, the PR #75 Codex
  review feedback) and one where the fake pnpm exits non-zero with a
  stderr message (asserting the existing numeric-status branch
  surfaces both the exit code and the stderr body). Tests are
  independent of the host's real pnpm install (the shadow PATH points
  at the per-case tmp dir) and of `node_modules/` so the script can be
  validated in any bash + node environment.
- CI coverage gate `scripts/check-coverage.mjs` (#11) — Node ESM script
  intended to be invoked by the `backend-checks` CI job
  (`docs/adr/012-lefthook-ci-gates.md`) after
  `pnpm exec vitest run --coverage` once the workflow wiring lands in a
  follow-up PR. This change ships the script and its test runner only;
  no `.github/workflows/` files are modified. Reads an
  Istanbul `json-summary` file (emitted by `@vitest/coverage-v8` with
  the `json-summary` reporter), aggregates `lines` and `branches`
  counts across every per-file entry whose path contains the requested
  workspace package directory, then exits non-zero when either metric
  falls below the declared integer threshold. Contract is
  `node scripts/check-coverage.mjs <coverage-summary.json> <package-path> <threshold>`
  with the four documented thresholds: `packages/core ≥ 90 %`,
  `packages/review-engine ≥ 85 %`, `packages/config ≥ 85 %`,
  `apps/community-bot ≥ 70 %`. Exit codes follow the convention shared
  with the other `scripts/` guards: `0` on success (both metrics at or
  above threshold) with a one-line `OK: <package-path> lines XX.XX % |
  branches XX.XX % | N files | >= T %` written to stderr so CI logs
  show what the gate actually scanned, `1` on a threshold violation
  with a `BLOCKED:` stderr message naming the package, the threshold,
  the failed metric(s) with observed `pct` and `covered/(total - skipped)`
  raw counts, the JSON source path, and the file count, and `2` on an
  infrastructure error (wrong argc, non-integer or out-of-range
  threshold, absolute or `..`-containing `<package-path>`, unreadable
  file, malformed JSON, `null` or array root, zero per-file entries
  matching the requested package — the `"total"` sentinel is filtered
  out before matching — or every matched entry having zero countable
  units across both `lines.total` and `branches.total`, which signals a
  Vitest misconfiguration where the package was scanned but nothing was
  instrumented and that the gate refuses to silently pass).
  Per-file matching accepts both the absolute paths Istanbul emits by
  default (`/.../packages/core/src/foo.ts`) and workspace-relative
  paths (`packages/core/src/foo.ts`) for bespoke fixtures, and the
  trailing slash on the path segment guards against sibling-directory
  false positives — `packages/core` never pulls in entries from
  `packages/core-extras`. Aggregation works on raw integer counts
  rather than per-file `pct`, so Istanbul's `"Unknown"` string
  (emitted when a file has zero countable units) is ignored naturally.
  A package with zero branchable units overall
  (`branches.total - branches.skipped === 0`) is treated as 100 %
  for that metric, mirroring Istanbul's vacuous-true semantics. The
  threshold comparison itself runs in integer arithmetic
  (`covered * 100 < threshold * denom`) rather than on the displayed
  `pct` float, so IEEE 754 boundary surprises such as
  `(29 / 100) * 100 === 28.999999999999996` cannot produce a
  false-fail at exactly-on-threshold inputs. No runtime dependencies —
  `node:fs` plus `node:process` only, ESM via `.mjs`, runs on the
  Node 24 pinned in `.nvmrc`. Companion `scripts/check-coverage.test.sh`
  runner exercises 32 acceptance scenarios in isolated `mktemp -d`
  directories with synthetic `coverage-summary.json` fixtures: twelve
  PASS cases (both metrics well above threshold with absolute keys, the
  same with workspace-relative keys, metrics exactly at the threshold,
  a package with zero branchable units, a per-file `pct === "Unknown"`
  ignored by aggregation, threshold 0 with 0 % coverage, threshold 100
  with full coverage, weighted multi-file aggregation reaching the
  bound, a `packages/core-extras` sibling correctly excluded from
  `packages/core`, an `apps/community-bot` path variant, an
  IEEE 754 boundary regression at `covered=29, denom=100, T=29`, and a
  success-line assertion confirming the `OK:` summary appears), four
  FAIL cases (lines below, branches below, both below, and threshold
  100 not reached by 99 %), and sixteen ERROR cases (missing
  package-path or threshold or extra arg, non-numeric / decimal /
  negative / out-of-range threshold, absolute or `..` package-path,
  missing summary file, invalid JSON, `null` or array root, no
  entries matching the package path, a summary with only the
  `"total"` sentinel, and every matched entry having zero countable
  units). Tests are independent of pnpm and Vitest so the script can
  be validated in any bash + node environment.
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
  The relative-climb alternative requires `cloud-api` to be a full
  path segment: a `(.*/)?` anchor demands every character preceding
  `cloud-api` on this side of the `../` to be either nothing or end
  with `/`, and a trailing `[/'"]` requires a path or quote boundary
  after the segment. This rejects both `../cloud-api-mock` (trailing
  suffix) and `../mock-cloud-api/x` (leading prefix) as parent-sibling
  imports while still catching `../../apps/cloud-api/y` and
  `../cloud-api/y` (PR #73 review, Codex). `+`, `-` and `)` are added
  to the dynamic punctuation whitelist so `"prefix" + import("...")`,
  `-import("...")` and `if (ok) import("...")` expression contexts
  are caught (PR #73 review, cubic-dev-ai and Codex). The dynamic
  alternative quote class also accepts a backtick so
  `import(`@sovri/cloud-api`)` template-literal specifiers do not
  bypass the gate (PR #73 review, Codex).
  Companion `scripts/check-boundary.test.sh` runner exercises 41
  acceptance scenarios (17 PASS + 24 BLOCK) in isolated temporary git
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
- Onboarding installer `scripts/install-hooks.sh` (#13) — single-command
  bash entry point for new contributors that resolves the
  `pnpm install --frozen-lockfile && pnpm exec lefthook install` sequence
  pinned in ARCHI §16.2 and prints the `--no-verify` forbidden reminder
  required by the project rules. Sequence: (1) preflight checks via a
  `require()` helper for `git`, `node` and `pnpm` — each missing tool
  yields a `MISSING: <name>` line with an `Install:` hint and aborts the
  whole script with a single `Missing tools. Install them then re-run`
  summary so a fresh clone sees every gap at once instead of one error
  per attempt; (2) repo-root anchoring via `git rev-parse
  --show-toplevel` after resolving `BASH_SOURCE[0]` through any chain of
  symlinks via a POSIX `readlink` loop (no GNU `readlink -f` dependency)
  so a contributor PATH-shim like `~/bin/sovri-install ->
  scripts/install-hooks.sh` lands on the real script directory — `dirname
  "$0"` alone would have yielded the symlink's parent (`~/bin/`), git
  rev-parse would then fail outside the repo and the fallback would run
  `pnpm install` against the wrong tree; the `dirname "$SCRIPT_DIR"`
  fallback only kicks in when git itself cannot locate a worktree (e.g.
  running from a tarball checkout); (3) a Node major-version probe
  that reads the pinned major from `.nvmrc` (`head -n 1 | cut -d. -f1`,
  defaulting to `24` when the file is unreadable so a missing `.nvmrc`
  does not silently disable the warning) and emits a non-blocking
  warning when the local node is below it, leaving the call site free
  to proceed under a recent-enough patch release while flagging the
  drift for follow-up; the probe also tolerates non-numeric `node -p`
  output (empty string, leading-`v` shims, `nvm` labels) by surfacing a
  parse-warning and continuing — without this guard the arithmetic
  `[ "$NODE_MAJOR" -lt 24 ]` would raise `integer expression expected`
  and `set -euo pipefail` would turn a soft warning into a fatal abort;
  (4) the install itself with `--frozen-lockfile` (CI parity per the
  ALWAYS rule in CLAUDE.md) and `--ignore-scripts` (ADR-009 + the
  mini-shai-hulud surface-reduction stance documented in §9), so a
  compromised transitive `postinstall` cannot execute during onboarding
  even though the same install runs unprivileged on a contributor laptop
  — defence-in-depth on top of `.npmrc`'s global `ignore-scripts=true`
  so the policy holds even if `.npmrc` is missing or modified; (5)
  `pnpm exec lefthook install` to materialise the pre-commit + pre-push
  hook files declared by `lefthook.yml`; (6) a verification step that
  resolves the hooks directory via `git rev-parse --git-path hooks`
  (worktree-safe — `.git` is a pointer file, not a directory, in any
  worktree under `.worktrees/`, and a literal `.git/hooks/` check would
  falsely fail even when lefthook installed the hooks correctly into
  the linked gitdir) and then asserts `pre-commit` and `pre-push` both
  exist by exact filename AND carry the executable bit — `git init`
  always seeds `*.sample` siblings, so the earlier `ls | grep` pattern
  from the ARCHI draft would have silently passed even when lefthook
  installed nothing, hence the swap to four explicit `[ -f ... ]` +
  `[ -x ... ]` tests that are POSIX-portable, immune to the false
  positive, and catch the second-order regression where the files
  exist but `git` silently skips them because the executable bit is
  unset (umask collision, FUSE filesystem, etc.). The script is
  idempotent (every command in the sequence tolerates a clean re-run:
  `pnpm install --frozen-lockfile` is a no-op on an already-consistent
  `node_modules/`, `lefthook install` overwrites identical hooks, and
  the verification check makes no state changes), uses `set -euo
  pipefail` for fail-fast semantics. No GNU-only flags (`ls -la`,
  `grep -E`, `command -v`, `head -n 1`, `cut -d. -f1` are all POSIX or
  POSIX.1-2008), no external dependencies beyond the tools whose
  presence the script itself verifies. Companion
  `scripts/install-hooks.test.sh` runner exercises 15 acceptance
  scenarios in isolated `mktemp -d` git repos with a hermetic
  `PATH=$repo/bin` built from symlinks to system utilities plus
  per-case stubs for `pnpm`, `lefthook` and `node` and a real `git`
  symlink (the wrapper now invokes `git rev-parse` so a noop stub no
  longer suffices) — a missing tool truly fails `command -v` and a
  stubbed tool deterministically controls behaviour without ever
  running a real `pnpm install`. Each case also exports
  `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` so a
  contributor with `core.hooksPath` set globally (e.g. a personal hooks
  dir like `~/.claude/git-hooks`) cannot leak into the temp repo and
  mask a real verification failure — the script picked that path up
  during initial development and silently exited 0 against an empty
  `.git/hooks/`. The 15 cases break down as seven PASS (happy path
  with every tool present and `pnpm install --frozen-lockfile
  --ignore-scripts` flag-forwarding asserted by a strict stub that
  exits non-zero on a missing flag; idempotent double-run; future-major
  node 99 with no warning; the install + verify substrings present in
  stdout; non-numeric `node -p` output `v24` surfaces a
  `WARNING: could not parse Node major version` and continues to
  `==> Ready.` without aborting under `set -e`; an out-of-repo PATH-shim
  symlink — `/tmp/.../sovri-install -> $repo/scripts/install-hooks.sh`
  — invoked from outside the worktree still lands on the real repo
  root via the `BASH_SOURCE`+`readlink` loop, proving the symlink fix
  actually works rather than just being a comment), three WARN
  (node 20 vs pinned-24 emits `WARNING: Node 20`; `.nvmrc` absent
  falls back to default pin 24 and still warns on node 20; `.nvmrc`
  pinned to a higher major than the local node — `26.0.0` vs node 24
  — emits the bump-ahead warning so a contributor preempting the next
  LTS bump sees the drift), and five BLOCK (missing git, missing node,
  missing pnpm each surface their `MISSING: <name>` line and the
  aggregated `Missing tools. Install them then re-run this script.`
  summary before exiting 1; a `pnpm exec lefthook install` no-op that
  leaves the hooks directory empty trips the verification check with
  `ERROR: hooks not installed`; hook files written without the
  executable bit trip the same check with the augmented `(or not
  executable)` message — defends against umask/FS-driven regressions
  where the files exist but git silently refuses to run them). The
  runner is bash-only and independent of pnpm/Vitest so it runs
  anywhere bash + git are available, matching the convention shared
  with the other `scripts/*.test.sh` guards (#7, #10, #11, #12).

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
