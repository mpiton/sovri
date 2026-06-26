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
(not published) starting at v0.9, when that directory is scaffolded.

---

## [Unreleased]

### Added

- `review-engine`: add an ATDD guard for MAT-80 project-level compliance
  vocabulary definitions across tracked ADR docs with explicit assertion
  diagnostics, ADR-022 content checks, duplicate-term detection, and
  missing-vocabulary and regex-backed affirmative finding-category misuse
  detection, including a project-level output explanation backed by a shared
  required-terms source, plus model-split coverage for the source compliance model
  and PR review projection, including helper-backed missing-projection detection, plus
  glossary-scoped, assertion-consistent docs-test
  coverage that keeps `Finding` separate from project-level `ComplianceGap`
  output, covers rejection of PR review findings as the source compliance model,
  including across real project docs where the project source model is also
  documented, records the MAT-77 to MAT-113 supersession, and adds traceability
  coverage for the superseded and rules-engine issue identifiers, plus
  helper-backed MAT-112 core-domain-model violation detection with project-doc
  coverage, real-doc-backed output-contract-entry detection, and explanatory
  failure messaging, plus
  helper-backed active-history violation detection for fixtures and project docs,
  plus helper-backed unmentioned-MAT-77 supersession-history coverage,
  issue-scope separation coverage for MAT-112 and MAT-113, and
  helper-backed path-normalized stale-snapshot violation detection with
  formatted failure messaging for source/snapshot docs change sets, plus
  flexible unchanged-source coverage that avoids snapshot churn for ADR-only
  changes, plus helper-backed ADR-index coverage for new or revised ADR
  entries and missing new/revised ADR failures.

### Changed

- `review-engine`: a finding is now published only when it maps to a compliance
  framework. After enrichment, any finding left with an empty
  `compliance_references` list — its CWE resolved to no framework reference, or
  its category/confidence kept it out of enrichment — is dropped before it
  reaches the pull request instead of being posted unmapped. This makes
  compliance-only the default review behaviour: Sovri surfaces regulatory-anchored
  findings and withholds generic review noise. SARIF scanner findings are enriched
  on the same path, so a SARIF finding whose CWE maps to a framework is kept while
  an unmapped one is dropped. Retained findings keep their `audit_reference`, and
  the dropped count is logged (`dropped_unmapped`) so the reduction is auditable,
  never silent (MAT-75).
- `review-engine`: the review system prompt is recentred on regulated compliance.
  All four modes (`full`, `bugs-only`, `strict`, `minimal`) now ask the model only
  for security and correctness weaknesses that map to a known CWE and no longer
  solicit generic bug, style, performance, or maintainability review. The shared
  CWE directive is now unconditional — every finding should carry a `cwe` — which
  drops the prior "omit `cwe` on style or performance findings" escape hatch. This
  stops the model from spending effort on findings the compliance-only publication
  gate (MAT-75) would discard, reducing non-compliance noise at the source
  (ADR-021, MAT-76).
- `deps`: align the Community runtime toolchain pins by updating the pnpm
  package manager pin, Node.js CI/runtime floor, digest-pinned Docker base
  images, runtime preflight hooks, and the Probot dependency specifier used by
  the bot.

### Removed

- `core` (**breaking**): the `Category` enum (`CategorySchema`, exported from
  `@sovri/core`) is trimmed from seven values to the compliance-eligible set
  `"bug"` and `"security"`. The generic categories `"performance"`,
  `"maintainability"`, `"style"`, `"documentation"`, and `"test-coverage"` are
  removed, so a model finding tagged with one is now rejected at the parsing schema
  (`LLMRawFinding` / `ProviderFinding`) rather than enriched-then-dropped. The
  `@sovri/brand` category palette and the audit-reference category-code table are
  reduced to match. Consumers that persist or switch on the removed category
  strings must migrate to the security/bug taxonomy (ADR-021, MAT-76).

### Fixed

- `ci`: make workspace TypeScript resolution use package source entrypoints so
  `tsc -b` no longer depends on concurrently generated `dist` declarations
  during local hooks.

## [0.10.1] - 2026-06-22

### Fixed

- `bot`: `.sovri.yml` is now read from the base branch tip (`heads/<base.ref>`)
  instead of the per-PR frozen `base.sha`, so a config fix committed to the base
  branch reaches already-open PRs on the next review without a manual
  rebase/update-branch; config still never comes from the PR head, preserving the
  trusted-base guarantee (#2645, R-01/R-02/R-03).
- `bot`: a `.sovri.yml` schema validation failure now posts a PR comment that
  names each offending field path and its schema message — multiple issues
  joined with `"; "`, nested paths dot-joined, a root-level issue rendered as
  `(root)` (e.g. `Config error in .sovri.yml: limits: Unrecognized key; llm:
  Required`) — instead of the bare `review failed`, so the PR author can fix the
  config without bot-host log access (#2644, R-01).
- `bot`: a `.sovri.yml` YAML syntax failure now surfaces the parse error's own
  file-named message (`Failed to parse YAML at .sovri.yml`) instead of the bare
  `review failed`, without echoing the raw parser cause (which may quote
  untrusted file bytes); the surfaced message passes through the module's
  redaction + length cap as defense in depth (#2644, R-02).
- `bot`: the actionable `.sovri.yml` config-error comment is routed through
  `sanitizeErrorMessage`, capping it at 240 characters
  (`MaxLoggedErrorMessageLength`) — a config with many schema issues truncates to
  240 chars plus `...` rather than posting an oversized comment (#2644, R-03).

### Security

- `bot`: the actionable `.sovri.yml` config-error comment redacts any
  secret-shaped fragment (a field path matching api-key / token / secret) to
  `[Redacted]` via the shared `sanitizeErrorMessage` pass, so a credential-named
  config key is never echoed verbatim to the PR author — including when a comment
  mixes ordinary and secret-shaped paths, where only the secret-shaped one is
  redacted (#2644, R-04).
- `bot`: a `.sovri.yml` symlink rejection (`SovriConfigSymlinkError`) stays on the
  generic `review failed` comment and never names the file, since its cause may
  carry attacker-chosen target bytes — guarded so the diagnostic carve-outs for
  schema/parse errors can't later leak the symlink path (#2644, R-05).

## [0.10.0] - 2026-06-21

### Added

- `review-engine`: regression guard for the compliance-reference contract — a
  security/bug finding with a mapped CWE renders its framework references
  (e.g. CWE-89 → GDPR Art. 32) in the walkthrough "Compliance & provenance"
  section, only when the enrichment gate is satisfied (#2611, bug-2606 R-01).
- `review-engine`: regression guard for the compliance gate's negative path — a
  finding that does not clear the gate (ineligible category, unmapped CWE, or
  confidence < 0.7) renders no framework reference, preventing false regulatory
  attribution (#2612, bug-2606 R-03).
- `compliance` / `review-engine`: deterministic compliance reference derivation —
  a security or bug finding the model returned without a CWE now derives a mapped
  CWE from its own signals (e.g. raw SQL string concatenation → CWE-89 → GDPR
  Art. 32) and surfaces informational framework references with no second LLM
  call; ambiguous, low-confidence, or ineligible findings still decline. The XSS
  signal is word-boundaried so derivation never fires on an unrelated word that
  merely contains "dom" (ADR-020, #2610, #2616, #2622).
- `review-engine`: regression guard for the model-supplied CWE path — a finding
  that already carries a CWE renders exactly as before; derivation never
  overrides it (CWE-79 / CWE-256 kept, CWE-89 never derived over them) and does
  not rescue an unmapped model CWE (feat-2610 R-02, #2617).
- `review-engine` / `compliance`: regression guard for the derivation decline path
  — a no-cwe finding emits no framework reference when its content maps to no
  vulnerability class, when confidence is below 0.70, or when the category is not
  security/bug; the deriver also declines when content is ambiguous across rules
  (feat-2610 R-03, #2618).
- `review-engine`: regression guard for the 1024-byte system-prompt cap — every
  review mode (enumerated from the schema, so new modes are covered) stays
  within the cap and `validateSystemTemplateSize` accepts a
  1024-byte template while rejecting 1025, so the CWE-directive growth (mappable
  CWE, positive instruction, framework names) cannot silently overflow the
  system template (#2607, bug-2607 R-04).

### Fixed

- `llm-providers`: the Mistral structured-response schema now reaches OpenAI parity —
  it previously sent the raw Zod JSON schema under `strict: true`, leaving optional
  finding fields (notably `cwe`) out of `required`, so the model was never forced to
  decide them; optional fields are now promoted into every object node's `required`
  array and made nullable (enum-typed fields via `anyOf`, so null is actually accepted), so a
  strict-mode Mistral model must decide `cwe` on every finding
  instead of silently omitting it, which previously starved compliance enrichment on Mistral
  relative to OpenAI (#2638, bug-2609 R-01).
- `llm-providers`: a Mistral response that returns `cwe: null` (now possible under the R-01
  strict schema) round-trips instead of failing validation — the null is stripped to "no cwe"
  before parsing (the same null-strip OpenAI already applies), matching `@sovri/core`'s
  `cwe?: string` contract; an omitted cwe still parses, a malformed cwe is still rejected
  (#2639, bug-2609 R-02).
- `review-engine`: the provider finding schema now documents the `cwe` field — the
  generated provider JSON schema exposes a non-empty `description` telling the model
  to emit a CWE for any security or correctness weakness in `CWE-<number>` format.
  The field stays optional, so a finding without a CWE still parses; providers just
  no longer receive it with zero guidance on when to populate it (#2608, bug-2608 R-01).
- `review-engine`: the provider finding schema now requires a `category` — the
  `.default("maintainability")` is dropped, so a finding the model returns without a
  category fails validation (a Zod error on `category`) and re-prompts through the
  existing schema-retry re-prompt instead of being silently coerced to
  `maintainability`, an ineligible category that would downgrade a real security
  finding out of compliance enrichment. Aligns the provider schema with the sibling
  raw-finding schema, which already required `category`; the regression test covers
  every `CategorySchema` member (#2608, bug-2608 R-02).
- `review-engine`: the LLM review prompt now only shows CWE ids the compliance
  map resolves — the few-shot worked example (now a SQL-injection finding) and
  the directive's "for example" use CWE-89 (mapped) instead of the unmapped
  CWE-287, so a model imitating the example emits a mappable CWE instead of one
  that renders no compliance reference (#2607, bug-2607 R-01).
- `review-engine`: the CWE directive now positively requires a CWE on every
  security or bug finding tied to a known weakness, replacing the soft "omit
  otherwise" escape hatch with an omission scoped to style and performance
  findings, so the model is biased to emit a mappable CWE exactly where
  compliance enrichment can fire (#2607, bug-2607 R-02).
- `review-engine`: the CWE directive now names the target compliance frameworks
  (GDPR, DORA, AI Act, NIS2) so the model understands why a CWE is load-bearing
  on a regulated finding, kept within the 1024-byte system-prompt cap
  (#2607, bug-2607 R-03).
- `review-engine`: keep re-review finding identity stable under normal model
  drift in span, category, and CWE metadata so still-open inline findings are
  not re-posted as duplicates while changed source still receives a new finding;
  blank-only spans now use a dedicated, explicit fallback anchor to avoid
  body-only collisions, and source anchor selection no longer depends on
  whether `line_end` includes the first non-blank line (#2601).

### Security

- `deps`: override transitive `@opentelemetry/core` to `2.8.0`,
  `protobufjs` to `7.6.3`, and `@babel/core` to `7.29.6` to clear
  Dependabot alerts GHSA-8988-4f7v-96qf, GHSA-f38q-mgvj-vph7, and
  GHSA-4x5r-pxfx-6jf8 from the workspace lockfile.
- `deps`: override transitive `vite` to `8.0.16` to clear GHSA-fx2h-pf6j-xcff
  from the Vitest toolchain audit path.

## [0.9.2] - 2026-06-16

### Fixed

- `bot`: the v0.9.1 deploy image still shipped the LLM provider SDKs unresolvable. `pnpm deploy` leaves a workspace package's dependencies in the closure's `.pnpm` store without linking them, so `@sovri/llm-providers` threw `ERR_MODULE_NOT_FOUND` and every review failed. Link `@mistralai/mistralai`, `@anthropic-ai/sdk`, and `openai` at the closure's `node_modules` root, and move the provider smoke check into the runtime stage so it validates the shipped closure (the v0.9.1 check ran against the full workspace install and false-passed).

## [0.9.1] - 2026-06-16

### Fixed

- `bot`: package the LLM provider SDKs (`@mistralai/mistralai`, `@anthropic-ai/sdk`, `openai`) in the deploy image. `pnpm deploy --legacy` left them unlinked in the deployed closure, so the provider threw `ERR_MODULE_NOT_FOUND` at review time, swallowed into a bare `review failed` on every PR. Dropped `--legacy` and added a build-time smoke check that instantiates each provider so a missing SDK fails the build (#2598).
- `bot`: when a review is declined because the PR exceeds the configured size limit (`maxFilesPerReview` / `maxLinesPerReview`), post the actionable reason on the PR (e.g. `Pull request exceeds review limits: 77 files changed, max 50.`) instead of a bare `review failed`. Previously the handler treated every failed-status review identically and discarded the limit message, so re-reviewing an oversized PR looped on an unexplained `review failed`. Failures that may carry untrusted provider output (`provider_error`, `parse_error`) still post the generic message and never echo the review summary. Backed by a new machine-readable `failure_reason` on the `Review` contract (`@sovri/core`), set by the review engine and consumed by the bot.

### Added

- `core`: optional `failure_reason` field on `ReviewSchema` (`limit_exceeded` / `provider_error` / `parse_error` / `unexpected_error`) classifying why a review failed, so callers can decide whether the human-readable summary is safe to surface.


## [0.9.0] - 2026-06-14
### Added

- `ci`: per-file license-header gate (`scripts/check-headers.mjs`, fail-closed). `packages/**` and `apps/community-bot/**` must carry the Apache 2.0 header (`SPDX-License-Identifier: Apache-2.0` + `Copyright <year> Sovri contributors`); `apps/cloud-api/**` must carry the `Proprietary — Sovri` header and must not claim Apache (license-leak guard). Runs in lefthook pre-commit (staged blob) and a blocking CI job (full tree), mirroring the import-boundary guard (ADR-010). Covers `apps/cloud-api/**` ahead of its scaffold so the directory is gated the moment it lands.
- Root `NOTICE` file naming the legal copyright holder (Mathieu Piton, sole proprietor) behind the collective `Sovri contributors` notice.
- `bot`: review pull requests on `pull_request.ready_for_review`. A draft PR marked ready for review now runs the same review flow as `pull_request.opened` (the handler delegates to `handlePullRequestOpened`), so the review fires immediately on ready-for-review instead of waiting for an unrelated `synchronize` push. The ready-for-review review runs regardless of `review.autoReviewDrafts`, since a `ready_for_review` payload is never a draft. Draft skip is unchanged and regression-guarded: a draft `pull_request.opened` is still skipped when `review.autoReviewDrafts` is false, and reviewed only when it is enabled. No new webhook subscription — `ready_for_review` is an action of the already-required `pull_request` event. (#2505)

### Changed

- Standardize the Apache 2.0 copyright holder across every published source header from `Sovri SAS` to `Sovri contributors`. `Sovri SAS` was inaccurate: Sovri is a sole proprietorship (entreprise individuelle), not an SAS. Header-pinning contract tests and scaffold checks are updated to match.

- Correct the proprietary `apps/cloud-api/**` header from `Proprietary — Sovri SAS` to `Proprietary — Sovri` for the same reason. The directory has no files yet, so this only updates the gate rule and its tests.

- `docs`: make the `apps/cloud-api/` creation timing consistent with the roadmap. The Cloud edition is scaffolded at v0.9 (after the Go/No-Go gate) and reaches Cloud Beta at v1.0, instead of being created at v1.0. The version annotations in ADR-002 and `pnpm-workspace.yaml` are made version-agnostic so the roadmap stays the single source for the timing.

### Deprecated

### Removed

### Fixed

- `bot`: detect at boot when the GitHub App is not subscribed to a webhook event the registered
  handlers require, and log a warning naming the missing event(s) instead of failing silently. The
  bot reads its subscribed events from the GitHub App API (`GET /app`), compares them against the
  events its handlers need (`pull_request`, `issue_comment`), and warns on any gap. Previously a
  deployment subscribed only to `issues` + `pull_request` (missing `issue_comment`) would drop every
  `@sovri-bot` command with no delivery, no log, and no error. Startup still continues, and the check
  fails open: if the subscribed events cannot be fetched, the bot warns that the check could not run
  rather than aborting. A drift-guard test keeps `REQUIRED_WEBHOOK_EVENTS` in sync with the events
  the handlers actually register (bug #2504, rules R-01..R-04).

### Security

- `deps`: pin `esbuild` to `0.28.1` via a `pnpm.overrides` entry to patch GHSA-gv7w-rqvm-qjhr
  (high): esbuild's dev server accepted cross-origin requests, enabling remote code execution via
  `NPM_CONFIG_REGISTRY`. esbuild is a deep transitive dependency (`vitest` → `vite` → `esbuild`)
  with no direct entry to bump, so an override is the deterministic fix. Dev/test toolchain only;
  the distroless runtime image ships no esbuild.

## [0.8.0] - 2026-06-10

### Added

- SARIF 2.1.0 report reader in `@sovri/review-engine`: validates an untrusted scanner report at
  the boundary, accepting only valid JSON whose `version` is exactly `2.1.0` (the `$schema` field
  is optional and ignored) and rejecting malformed or wrong-version reports with a typed
  `SarifParseError` that preserves the underlying JSON/Zod error as `cause` (rule R-01, part of
  SARIF ingestion).
- SARIF input bounds in `@sovri/review-engine`: a report over 10 MiB or nested beyond depth 64 is
  skipped before parsing (UTF-8 byte size plus a string-aware, non-recursive bracket-depth scan
  that never calls `JSON.parse`), and mapped SARIF findings are capped at 1000 per review with a
  deterministic overflow drop (rule R-02).
- SARIF report ingestion isolation in `@sovri/review-engine`: `ingestReport` parses a report (a
  whole-report failure throws `SarifParseError`) then walks each result, dropping an off-spec one
  (e.g. a result with no physical location) with a counted reason while its siblings still ingest,
  and returns an ingestion summary of results seen / mapped / skipped (rule R-03).
- SARIF result-to-Finding mapping in `@sovri/review-engine`: `mapSarifResult` projects a mappable
  SARIF result onto a core `Finding` (`source: "sarif"`) with a generated id and audit reference,
  resolving the human message from `result.message.text`, else the rule's `messageStrings[id]` with
  `{n}` argument substitution, else a deterministic fallback, and truncating over-long
  title / body / recommendation to the schema caps rather than dropping the result (rule R-04).
- Safe SARIF file resolution in `@sovri/review-engine`: `resolveSarifFile` resolves a result's
  physical location to a repo-relative path through the uri chain (`artifactLocation.uri`, else
  `run.artifacts[index].location.uri`), resolving or refusing `uriBaseId`, percent-decoding, and
  dropping a non-relative scheme, an absolute path, or a repo-escaping traversal — an untrusted
  artifact can never surface a finding outside the repository (rule R-05).
- SARIF severity and kind mapping in `@sovri/review-engine`: a result's `level` maps to Finding
  severity (error→major, warning→minor, note→info, none→nitpick) following the precedence
  `result.level` → `rule.defaultConfiguration.level` → default warning, and `resultKindReason`
  drops a result whose `kind` is not `fail` (pass / open / informational / notApplicable / review),
  with kind-absent defaulting to fail (rule R-06).
- SARIF CWE extraction in `@sovri/review-engine`: `extractCwe` canonicalizes a CWE id to `CWE-<n>`
  (no leading zeros) from Semgrep `rule.properties.cwe`, CodeQL zero-padded `external/cwe/cwe-NNN`
  tags, and `taxa` / `rule.relationships` resolved against `run.taxonomies`, consulted in document
  order with the first valid id winning; CWE stays optional (rule R-07).
- SARIF suppressions and scan-failure surfacing in `@sovri/review-engine`: `resultSuppressionReason`
  drops a result whose `suppressions[]` carries an `accepted` state (an empty array or an
  under-review suppression still maps), and `countScanFailures` counts a run's failed invocations
  (`executionSuccessful: false`) and error-level tool notifications so a failed scan is not
  presented as clean; tool notifications never become Findings (rule R-08).
- SARIF/LLM finding merge in `@sovri/review-engine`: `mergeSarifFindings` appends SARIF findings
  after the LLM findings and deduplicates — a SARIF finding colliding with an LLM finding (same
  file, same CWE, overlapping lines) collapses to the LLM one, and cross-tool SARIF duplicates
  collapse first-wins — surfaces SARIF only when its file is in the diff's changed-files set,
  applies the severity threshold and ignore rules, and orders the merged set by a stable tie-break
  (severity, source, file, line, id) for reproducible output (rule R-09).
- SARIF output surfacing in `@sovri/review-engine`: SARIF findings are counted in the
  "Sovri / review" Checks row, attributed in the walkthrough findings table via a `SARIF` source
  badge in the title cell (no core Finding change), with every SARIF-derived string escaped through
  the existing `formatTableCell` (rule R-10).
- SARIF ingestion wired into the review pipeline (`@sovri/review-engine`): `reviewPullRequest` accepts
  an optional `sarifReports` array of raw scanner reports and ingests each through the new
  `collectSarifFindings` conductor (bounds → parse → per-result kind / suppression / file-escape drops
  → rule resolution → mapping → CWE → cap), skipping an invalid report without failing the review.
  Survivors merge into the review findings (`mergeSarifFindings`), surface in the walkthrough via the
  `SARIF` badge, and flip the `Sovri / license-scan` Checks row from its neutral placeholder to
  success once a report is ingested. No reports leaves the LLM-only path unchanged. The SARIF engine
  and conductor are exported from the package entry point.
- `@sovri/cli` package with a `sovri verify <trail.jsonl>` command that verifies an audit trail
  offline (Ed25519 hash chain + signatures), reading the verification public key from the trail's
  `trail.started` entry or a `--public-key` PEM file; exits non-zero on tamper or malformed input.
- `createCommunityAuditTrailWriter` in `@sovri/compliance`: an opt-in, file-backed audit-trail sink
  that prepends the `trail.started` genesis and owns its signing key (operator-provided Ed25519 PEM,
  or an ephemeral key generated per trail), so a trail driven by the review orchestrator verifies
  offline.
- Opt-in Community audit trail in the bot, enabled via `SOVRI_AUDIT_TRAIL` + `SOVRI_AUDIT_TRAIL_PATH`
  (and optional `SOVRI_AUDIT_TRAIL_PRIVATE_KEY`); writes one signed JSONL trail per review, off by
  default. Documented in `docs/audit-trail.md`.

### Changed

- review-engine: clarify the SARIF `no-physical-location` drop contract — only a result with no primary `physicalLocation` is dropped; a present-but-partial location still maps with defensive defaults (R-05 owns uri resolution).
- docs: harmonize the `apps/cloud-api/` creation timing on v1.0+ across versioned sources (ADR-002, `pnpm-workspace.yaml`, this changelog). The directory is not created yet at v0.7; v1.0 is when the Cloud edition starts (see ADR-002 and the v1.0 roadmap).

### Deprecated

### Removed

### Fixed

### Security

## [0.7.0] - 2026-06-09

### Added

- cross-cutting invariants test for the batch-3 CWE compliance mappings.
- compliance mappings for authentication CWEs (307, 521) and Tier-2 crypto CWEs (327, 916).
- compliance mappings for resilience and logging CWEs (674, 754, 778, 223).
- compliance mappings for credential-protection and sensitive-info-exposure CWEs (256, 522, 359, 209).
- compliance mappings for cleartext storage/transmission and weak-hash CWEs (312, 319, 313, 328).
- compliance mapping for CWE-532 (sensitive data in logs) → GDPR/NIS2/ISO references; only GDPR Art. 32 is enforced, NIS2 and ISO 27001 are present but not required pending DPO review.
- COMPLIANCE_MIN_CONFIDENCE domain threshold in @sovri/core.
- compliance enrichment gate (security/bug + CWE + confidence >= 0.7); category filter is an explicit allowlist — style findings with a CWE are excluded by category, not by CWE absence.
- compliance references are now emitted on eligible security/bug findings.
- regression test locking compliance-reference rendering end-to-end through `composeWalkthrough`.

### Changed

- review prompt now asks the LLM for a CWE id (e.g. CWE-287) and a confidence score (0–1) on security/bug findings.
- compliance integration test: split weak `?? 0` existence guard into separate `toBeDefined()` + length assertions.
- bumped LLM SDKs (exact pins): `@anthropic-ai/sdk` 0.99.0 → 0.102.0, `openai` 6.39.1 → 6.42.0.
- bumped `js-yaml` 4.1.1 → 4.2.0 (config parser, community-bot).
- bumped dev tooling: `vitest`/coverage 4.1.7 → 4.1.8, `turbo` 2.9.15 → 2.9.16, `lefthook` 2.1.8 → 2.1.9, `knip` 6.14.2 → 6.16.1, `oxlint` 1.67.0 → 1.69.0, `oxfmt` 0.52.0 → 0.54.0.

## [0.6.0] - 2026-06-09
### Security

- `ci`: sign the Community-bot GHCR image with cosign keyless (Sigstore + GitHub OIDC) in
  `release.yml`. The `build-and-push` job gains `id-token: write` and signs the multi-arch manifest
  **by digest** — no private or KMS key is committed or referenced; the signing identity is the
  ephemeral GitHub OIDC token and the signature lands in the Rekor transparency log. Self-hosters can
  verify the published image before deploy with `cosign verify ...@sha256:<digest>
  --certificate-identity-regexp <release.yml> --certificate-oidc-issuer
  https://token.actions.githubusercontent.com` (documented verbatim in the workflow). The
  `cosign-signing` CI policy in `scripts/ci-policy.mjs` enforces keyless, by-digest, SHA-pinned,
  least-privilege signing and supersedes the earlier cosign deferral (R-01..R-09, #2442).
- `ci`: attach a SLSA build-provenance attestation to the Community-bot GHCR image in `release.yml`. A
  new `attest-provenance` job (`needs: build-and-push`, `id-token`/`attestations`/`packages: write`) runs
  `actions/attest-build-provenance` against `needs.build-and-push.outputs.digest` — the same digest cosign
  signs — and pushes the attestation to GHCR. Self-hosters prove how and where the image was built with
  `gh attestation verify oci://ghcr.io/mpiton/sovri/community-bot:<tag> --owner mpiton` (and
  `cosign verify-attestation --type slsaprovenance`), documented verbatim in the workflow. The
  `slsa-provenance` CI policy in `scripts/ci-policy.mjs` enforces digest binding, least privilege,
  SHA-pinned actions, a documented verify command, and no secret leakage (R-01..R-10, #2447).

### Added

- `docs`: self-host observability and image-verification guide (docs/observability.md) covering the
  three recommended OTel stacks, the `OTEL_*` variables and the no-op default, the `/metrics` endpoint
  with the five `sovri.*` metrics and the `review.*` spans, and the pre-deploy cosign + SLSA image
  verification steps (R-01..R-10, #2454).
- `feat(observability)`: wire a single shared `PrometheusExporter` (`MetricReader`,
  `preventServerStart: true`) into the meter provider and expose `getPrometheusExporter()` plus an async
  `collectPrometheusText()` serializer. The accessor returns `undefined` and the serializer resolves to
  `""` when telemetry is a NO-OP (`OTEL_EXPORTER_OTLP_ENDPOINT` unset); otherwise the serializer renders
  the aggregated `sovri.*` registry as Prometheus text. No second metrics port is opened (R-01..R-10,
  #2429).
- `feat(bot)`: serve `GET /metrics` as Prometheus text exposition (`text/plain; version=0.0.4`) from the
  operational router via a thin `sendText` helper — the bot serializes the shared exporter, it never
  aggregates or stores metrics. With telemetry off the endpoint returns `200` with an empty-but-valid
  body (a scraper reads an empty exposition as a healthy zero-series target, so a 503 would falsely mark
  the bot down); non-GET requests fall through and `/health`/`/version` are unchanged. The exposition
  carries only low-cardinality labels — never a token, LLM key, or PR payload (R-01..R-10, #2429).
- `test(bot,observability)`: add `@integration` acceptance tests for the `GET /metrics` Prometheus
  endpoint — `operational-routes.test.ts` (200 + `text/plain; version=0.0.4`, non-GET fall-through,
  telemetry-off 200 empty body, `/health`+`/version` unchanged, metadata-only logging, thin-adapter
  guards) and `metrics-reader.test.ts` (real `PrometheusExporter` with `preventServerStart: true`,
  accessor/serializer NO-OP, single shared instance, `sovri.*` serialization, no-leak) (R-01..R-10,
  #2429).
- `test(bot)`: add RED acceptance test (`tests/operational/otel-bootstrap.test.ts`) for the
  community-bot OpenTelemetry bootstrap — asserts the `instrumentation.js` import is the first
  statement in `server.ts` ahead of probot/observability/app, `initTelemetry()` runs once on import
  with no argument, graceful `SIGTERM`/`SIGINT` shutdown awaits `shutdownTelemetry()` before exit
  (double-signal-safe, a no-op shutdown resolves, a rejecting flush still exits non-zero), `/health`
  and `/version` serve unchanged with and without an OTLP endpoint, the bot stays a thin adapter, and
  no secret reaches the bootstrap (R-01..R-09, #2424).
- `feat(bot)`: bootstrap OpenTelemetry in the community bot. `instrumentation.ts` calls `initTelemetry()`
  as the first import side effect of `server.ts` — before probot/Octokit/http load — and `shutdown.ts`
  registers a graceful `SIGTERM`/`SIGINT` drain that awaits `shutdownTelemetry()` before exit
  (double-signal-safe, a no-op shutdown resolves cleanly, a rejecting flush still exits non-zero instead
  of hanging the container). With no `OTEL_EXPORTER_OTLP_ENDPOINT` set the bot boots and serves
  `/health`+`/version` exactly as before; the bot stays a thin adapter, so all telemetry logic remains in
  `@sovri/observability` and no token, LLM key, or raw webhook payload reaches the bootstrap
  (R-01..R-09, #2424).
- `feat(review-engine)`: emit the `sovri.reviews.total` (counter), `sovri.reviews.duration_ms`
  (histogram), and `sovri.findings.total` (counter) business metrics through `recordMetric`, defined
  once as a typed Zod registry in `metrics.ts`. Tags stay low-cardinality — `status`/`llm_provider`
  and `severity`/`category`/`source` taken straight from each validated `Finding`. `sovri.findings.total`
  fires once per emitted Finding, including the synthetic finding a parse-failure descriptor surfaces.
  Emission is best-effort: a metrics failure never disturbs the review and output is identical with
  metrics on or off.
- `feat(llm-providers)`: emit `sovri.llm.tokens` (once per `prompt`/`completion` direction per call)
  and `sovri.llm.errors` (with a class-derived `error_type`, never the error message) from the provider
  adapters via a shared `withLlmMetrics` helper, tagged with the provider name and model.
- `docs`: brand image kit under `assets/` (banner, three-step "how it works" illustration, review
  comment header/footer banners, OG/social cards, and a concept-art set in `assets/illustrations/`).
  The README gains a hero banner and a "How it works" section using the three-step illustration.
- `feat(brand)`: export `brandAssetUrls` — absolute `raw.githubusercontent.com` URLs for the review
  comment header/footer banners, validated at load. GitHub proxies Markdown images through camo, so a
  comment body needs an absolute URL (a repo-relative path only resolves in the rendered README). The
  schema rejects any URL without an `https://` scheme.
- `feat(review-engine)`: `composeWalkthrough` gains opt-in `brandHeader` / `brandFooter` options that
  prepend/append the Sovri banner images. Off by default, so the deterministic text-only walkthrough
  (ADR-016) and every existing golden/structure test are unchanged; the banner sits above, never
  replaces, the emoji verdict heading.
- `feat(bot)`: the community bot enables `brandHeader` / `brandFooter` when composing the PR review
  comment, so posted reviews carry the brand banners.
- `feat(review-engine)`: instrument `reviewPullRequest` with the `review.pull_request` business span
  tree — child spans `review.fetch_diff` / `review.build_prompt` / `review.llm_call` /
  `review.parse_findings`, carrying only non-sensitive scalar attributes (`pr.number`, `pr.repo`,
  `llm.provider`, `findings.count` set after parsing; child `changed_files`/`reviewable_files` and
  `provider.model`). The engine reaches tracing only through `@sovri/observability` `withSpan` and
  imports no `@opentelemetry/*`; behavior, return shape, error propagation, and audit events are
  unchanged, and the span path is a no-op when telemetry is uninitialized (R-01..R-09, #2413).
- `feat(observability)`: `withSpan` now forwards the active span to `fn` as a minimal `SpanLike`
  (`setAttribute` only), so callers can stamp an attribute computed during the operation without
  importing `@opentelemetry/*`. Backward-compatible — existing zero-argument callbacks are
  unaffected; `SpanLike`/`SpanAttributeValue` re-exported from the barrel (#2413).
- `test(review-engine)`: add RED acceptance test (`orchestrator.spans.test.ts`) for the
  `review.pull_request` business span tree — drives `reviewPullRequest` through the success, throw,
  provider/parse failure, partial, limit-exceeded and no-files branches with a captured `withSpan`,
  asserting the span tree shape/order, the parent's scalar attributes
  (`pr.number`/`pr.repo`/`llm.provider`/`findings.count` set after parsing), child attribute
  scoping, exception recording with unchanged error propagation, no leak of
  diff/prompt/response/LLM key, and no-op equivalence (R-01..R-09, #2413).
- `feat(observability)`: add the generic `withSpan`/`recordMetric` facade to
  `@sovri/observability` over `@opentelemetry/api`. `withSpan(name, fn, attributes?)`
  runs `fn` in an active span from the `"sovri"` tracer, returns its value unchanged,
  records the exception + ERROR status and rethrows the original on reject, and ends
  the span once in `finally`. `recordMetric(descriptor, value, tags?)` validates the
  descriptor against a Zod instrument model (`counter`/`histogram`), lazily creates and
  caches each instrument by name over the `"sovri"` meter, and routes the value by kind.
  Both stay no-op-safe when no SDK is started (OTel's own no-op tracer/meter). Re-exported
  from the barrel alongside `createLogger`/`initTelemetry`; `createLogger` API unchanged
  (R-01..R-09, #2406).
- `test(observability)`: add RED acceptance test for the generic `withSpan`/
  `recordMetric` facade over `@opentelemetry/api` — `withSpan` is a transparent
  pass-through that records the exception, sets ERROR status, and rethrows the
  original error on reject while ending the span once in `finally`; `recordMetric`
  lazily creates and reuses each instrument by name, rejects an unmodelled
  descriptor with a typed validation error, routes counter/histogram values with
  string tags, and stays a no-op when no SDK is running. OTel API mocked, no
  network (R-01..R-09, #2406).
- `chore(deps)`: add the pinned OpenTelemetry SDK set to `@sovri/observability`,
  declared but unused until the v0.6 telemetry init lands. Trace baseline:
  `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-node` 0.218.0,
  `@opentelemetry/auto-instrumentations-node` 0.76.0,
  `@opentelemetry/instrumentation-pino` 0.64.0,
  `@opentelemetry/exporter-trace-otlp-http` 0.218.0, `@opentelemetry/resources`
  2.7.1, `@opentelemetry/semantic-conventions` 1.41.1. Metrics, for the later
  `/metrics` endpoint: `@opentelemetry/sdk-metrics` 2.7.1,
  `@opentelemetry/exporter-prometheus` 0.218.0. All exact-pinned, Apache-2.0,
  install-script-free, audit/dedupe clean (R-01, R-03, R-04, R-05, R-08, #2396).
- `test(observability)`: add RED acceptance test asserting the v0.6 OpenTelemetry
  dependency set is exact-pinned, declared under `dependencies` only, recorded in
  the lockfile, Apache-2.0 licensed, with `createLogger`/`Logger` and the package
  `exports` map untouched (R-01, R-02, R-03, R-06, R-07, R-08, #2396).
- `feat(observability)`: add the OpenTelemetry SDK init/shutdown lifecycle to
  `@sovri/observability` — `initTelemetry()` starts a `NodeSDK` (OTLP trace
  exporter at `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`, fs/dns auto-instrumentation
  disabled, `PinoInstrumentation`) only when an OTLP endpoint is set and otherwise
  stays a complete no-op; `shutdownTelemetry()` drains it safely whether or not it
  started. The three `OTEL_*` env vars are read through a `zod` schema (added,
  exact-pinned `4.4.3`) so no secret-bearing env reaches a span or the exporter;
  NodeSDK default resource auto-detection is off (`autoDetectResources: false`) to
  keep that boundary closed, and a trailing slash on the endpoint is normalized.
  Init is trace-only: explicit empty `metricReaders` / `logRecordProcessors` stop
  NodeSDK auto-starting OTLP metric/log exporters from `OTEL_METRICS_EXPORTER` /
  `OTEL_LOGS_EXPORTER` (metrics are a later task). The bundled Pino auto-instrumentation
  is disabled so the standalone `PinoInstrumentation` is the only one (no double-wrap).
  `shutdownTelemetry()` deregisters the OTel global trace/context/propagation/metric/log
  providers (`@opentelemetry/api-logs` added, exact-pinned `0.218.0`; in a `finally`, so a
  failed drain still deregisters) so a later
  `initTelemetry()` re-registers a live pipeline instead of hitting duplicate-registration;
  the handle is cleared only after deregistration, so a concurrent init during an in-flight
  drain no-ops rather than starting an SDK the drain would tear down, and concurrent
  `shutdownTelemetry()` calls coalesce into a single drain. Both public functions carry JSDoc.
  Additive — the `createLogger`/`Logger` surface is unchanged (R-01..R-08, #2401).

### Changed

- `feat(core)!`: inline review comments now flag issues instead of narrating the diff (#2450). `Finding`
  and the provider response contract gain a **required** `recommendation` (`z.string().min(1).max(1000)`):
  `body` states what is wrong and why it matters, `recommendation` states the concrete fix. A finding
  with no fix is now structurally invalid, so a model cannot pass narration through validation. Inline
  comment bodies render `**Problem:**` / `**Fix:**` lines, and the four review-prompt modes are reframed
  from narrator to reviewer (report only defects and concrete improvements; a clean hunk yields no
  finding) within the unchanged 1024-byte system-prompt cap, with a few-shot example carried in the user
  prompt. An empty review renders `✅ No blocking issues found.` and zero inline comments. The PR
  description is never edited. Breaking schema change (new required field); pre-1.0, shipped as a minor
  bump.
- `build(bot)`: start the community bot under the OpenTelemetry auto-instrumentation hook. The
  `start` script and the Docker runtime `CMD` now run
  `node --require @opentelemetry/auto-instrumentations-node/register dist/server.js`, so the SDK loads
  before any instrumented module. `@opentelemetry/auto-instrumentations-node` (exact-pinned `0.76.0`,
  matching `@sovri/observability`) is now a direct bot dependency so the `--require` hook resolves at the
  app root under pnpm's isolated layout. The runtime image is otherwise unchanged — non-root `sovri`
  user, `EXPOSE 3000`, and the `/health` HEALTHCHECK all intact (#2424).

### Deprecated

### Removed

### Fixed

### Security

- `feat(observability)`: add a telemetry redaction guard (`redaction.ts`) that gates every span
  attribute and metric tag at the single `withSpan` / `recordMetric` choke point. A key outside the
  `ALLOWED_TELEMETRY_KEYS` allowlist (the four ARCHI §10.2.2 span attributes, the nine §10.2.3 metric
  tags, plus the non-sensitive operational `changed_files` / `reviewable_files` / `provider.model`)
  is dropped; a value matching a GitHub-token (`ghp_`/`gho_`/`ghu_`/`ghr_`/`ghs_`/`github_pat_`,
  including the stateless `ghs_APPID_JWT` format), LLM-key (`sk-`), PEM
  private-key, or webhook-payload JSON pattern is censored to `[Redacted]`; only scalars pass. The
  allowlist is one Zod enum (`z.infer`), detection is shape-anchored so benign values like `task-131`
  are kept, and `delivery_id` correlation stays in logs — never on a span or metric. The existing
  Pino `REDACT_PATHS` log path is asserted unchanged (R-01..R-10, #2437).
- `test(observability)`: add the RED acceptance test (`redaction.test.ts`) for the telemetry
  redaction guard — allowlisted span attributes / metric tags pass, off-allowlist keys drop,
  GitHub-token / LLM-key / PEM / webhook-payload values censor to `[Redacted]`, only scalars pass,
  the guard is pure and deterministic, `withSpan` / `recordMetric` route through it, and the Pino
  `REDACT_PATHS` log path stays redacted; includes a seeded property/fuzz pass (R-01..R-10, #2437).

## [0.5.0] - 2026-06-06
### Added

- `test(review-engine)`: add RED coverage for the preview markdown golden
  snapshot catalog across the summary, assessment, inline finding, and
  compliance provenance shapes (R-01, #2342).

- `test(review-engine)`: add RED coverage requiring preview catalog validation
  to fail and name the missing markdown golden file when a required snapshot is
  absent (R-01, #2343).

- `test(review-engine)`: add explicit inline preview snapshot coverage for
  suggestion fenced blocks, audit references, and byte-for-byte golden matching
  (R-01, #2344).

- `test(review-engine)`: add RED coverage requiring the preview HTML root to
  carry the shared wrapper class plus exactly one requested GitHub chrome theme
  class (R-02, #2345).

- `test(review-engine)`: add explicit preview HTML coverage proving light and
  dark renders differ only by the root theme class replacement (R-02, #2346).

- `test(review-engine)`: add RED coverage requiring theme-root validation to
  reject wrappers carrying both `gh-light` and `gh-dark` (R-02, #2347).

- `test(review-engine)`: add RED coverage requiring the preview HTML wrapper to
  inline exactly one local stylesheet without mutating markdown payload sections
  (R-03, #2348).

- `test(review-engine)`: add RED coverage requiring stored preview markdown
  snapshots to validate free of CSS-only wrapper fragments (R-03, #2349).

- `test(review-engine)`: add RED coverage requiring user-authored summary
  fixture `<style>` tags to render as inert markdown while the HTML wrapper
  keeps a single trusted style element (R-03, #2350).

- `test(review-engine)`: add RED coverage requiring each preview fixture to
  render twice in the same process with identical markdown bytes (R-04, #2351).

- `test(review-engine)`: add RED coverage requiring preview section generation
  to preserve the explicit catalog order regardless of reverse filesystem
  ordering (R-04, #2352).

- `test(review-engine)`: add RED coverage requiring determinism validation to
  reject generated preview output containing `generated_at` volatile bytes (R-04,
  #2353).

- `test(review-engine)`: add RED coverage requiring preview fixtures to validate
  placeholder repository, author, and provider key identity values (R-05, #2354).

- `test(review-engine)`: add RED scaffold coverage requiring preview TypeScript
  sources and the preview script to keep SPDX/Sovri headers, explicit `.js` ESM
  import extensions including side-effect and dynamic imports, and no CommonJS
  require/export usage (R-08, #2363).

- `test(review-engine)`: add RED coverage requiring preview fixture JSON and
  parsed values to pass through Zod-derived boundary validation before rendering
  (R-08, #2364).

- `test(review-engine)`: add RED scaffold coverage requiring the preview source
  quality gate to fail and name forbidden TypeScript escape-hatch fragments
  (R-08, #2365).

- `test(review-engine)`: extend the preview source contract quality gate to
  reject and name `any`, `as unknown`, `@ts-ignore`, and `@ts-expect-error`
  fragments (R-08, #2365).

- `fix(review-engine)`: constrain the preview escape-hatch scanner so ordinary
  prose containing `any` is allowed while explicit `any` type positions still
  fail the quality gate (R-08, #2365).

- `fix(review-engine)`: cover explicit `any` aliases and generic type arguments
  in the preview escape-hatch scanner while keeping prose strings/comments out
  of type-position matching (R-08, #2365).

- `fix(review-engine)`: preserve template-literal interpolation expressions in
  the preview escape-hatch scanner so casts inside `${...}` still fail while
  static template prose is ignored (R-08, #2365).

- `fix(review-engine)`: detect explicit `any` in preview union and intersection
  type positions while preserving template URL interpolations before comment
  stripping, keeping directive scans out of preview prose, and naming pattern
  fragments and capture groups for maintainability; quoted braces inside
  template interpolations and object-literal `as unknown` casts no longer hide
  escape hatches (R-08, #2365).

- `fix(review-engine)`: simplify redundant preview escape-hatch regex fragments
  and split template-literal scanning into documented helpers with loop-based
  label collection while keeping comment braces inside interpolations from
  hiding forbidden type fragments (R-08, #2365).

- `test(review-engine)`: add RED coverage requiring generated light and dark
  preview HTML output to contain no token prefixes, webhook signature marker, or
  raw webhook payload body (R-08, #2366).

- `feat(review-engine)`: expose Zod-derived preview fixture parsers for raw JSON
  text and parsed fixture values, and route preview fixture loading through that
  boundary before rendering (R-08, #2364).

- `feat(review-engine)`: add rendered preview output validation for token
  prefixes, webhook signature markers, and raw GitHub webhook payload bodies
  before local preview HTML files are accepted (R-08, #2366).

- `chore(review-engine)`: move the preview comments generator under the package
  `scripts/` source contract while preserving package-local `.preview/` output
  generation (R-08, #2363).

- `feat(review-engine)`: add the initial dev-only preview markdown fixture
  renderer and anonymized golden fixture catalog for the four review comment
  shapes (R-01, #2342).

- `feat(review-engine)`: add preview fixture catalog validation that reports
  missing markdown golden snapshots by filename (R-01, #2343).

- `feat(review-engine)`: add the initial preview HTML wrapper renderer with
  deterministic light and dark GitHub chrome root classes (R-02, #2345).

- `feat(review-engine)`: add preview theme-root validation that rejects wrappers
  carrying both GitHub chrome theme classes (R-02, #2347).

- `feat(review-engine)`: inline the local preview chrome stylesheet in the
  dev-only HTML wrapper while keeping markdown payload data unchanged (R-03,
  #2348).

- `feat(review-engine)`: add preview markdown payload validation that reports
  CSS-only wrapper fragments and reuses an exported preview chrome stylesheet
  list before posted markdown snapshot checks (R-03, #2349).

- `feat(review-engine)`: add a summary preview fixture case proving
  user-authored `<style>` tags stay escaped in markdown while the HTML wrapper
  keeps the only trusted style element (R-03, #2350).

- `feat(review-engine)`: add a deterministic fixture render helper that loads
  each preview fixture once and renders it twice for byte-for-byte comparison
  (R-04, #2351).

- `feat(review-engine)`: add preview section generation that follows the
  explicit fixture catalog order independent of filesystem listing order (R-04,
  #2352).

- `feat(review-engine)`: add determinism validation that reports `generated_at`
  as a volatile preview fragment (R-04, #2353).

- `feat(review-engine)`: add preview fixture anonymization validation for
  placeholder repository names, author logins, and provider key values (R-05,
  #2354).

- `feat(review-engine)`: detect and report secret-shaped and real identity
  values, including current GitHub token prefixes, direct array entries,
  embedded owner/repository names, and GitHub and `www.github.com` URLs with
  sentence punctuation or malformed URL escapes, without letting local source
  paths mask real repository leaks, in preview fixture anonymization validation
  (R-05, #2355).

- `feat(review-engine)`: keep preview provenance fixture placeholder provider
  keys available to anonymization assertions and regression tests while
  omitting them from rendered markdown (R-05, #2356).

- `feat(review-engine)`: add preview golden catalog validation that reports no
  required snapshot updates for unmodified preview fixtures as a
  raw byte-preserving catalog result with documented validation behavior plus
  focused edge-case coverage, exported helper types, and named helper guard
  coverage without repeated guard error subclasses (R-06, #2357).

- `test(review-engine)`: add RED coverage requiring markdown golden snapshot
  drift assertions to fail and name the affected golden file for every preview
  fixture shape and the real unmodified preview catalog path (R-06, #2358).

- `feat(review-engine)`: add a preview golden markdown assertion helper that
  throws with the affected golden snapshot file names when generated markdown
  drifts from stored snapshots, with documented custom snapshot source usage
  (R-06, #2358).

- `test(review-engine)`: add RED coverage requiring wrapper theme drift
  assertions to fail and name the affected preview theme (R-06, #2359).

- `feat(review-engine)`: add a preview theme-root assertion helper that fails
  wrapper theme drift with the affected theme name and expected GitHub chrome
  theme class (R-06, #2359).

- `test(review-engine)`: add RED coverage requiring the package manifest to
  expose a dev-only preview comments script without runtime preview rendering
  dependencies or build-script coupling (R-07, #2360).

- `feat(review-engine)`: expose a dev-only `preview:comments` package script
  that runs the existing local preview comment harness without adding runtime
  preview rendering dependencies or coupling it to `build` (R-07, #2360).

- `test(review-engine)`: add RED coverage requiring `preview:comments` to
  generate ignored light and dark HTML files outside package exports and the
  review-engine root barrel (R-07, #2361).

- `feat(review-engine)`: make `preview:comments` generate light and dark HTML
  previews under an ignored package-local preview directory without exporting
  generated artifacts (R-07, #2361).

- `fix(review-engine)`: make the preview-output scaffold assertion inspect the
  real package export map instead of an empty fallback (R-07, #2361).

- `test(review-engine)`: add RED coverage requiring the dev-only preview
  surface assertion to reject public package exports of `renderPreviewHtml`
  (R-07, #2362).

- `feat(review-engine)`: add a dev-only preview surface assertion that rejects
  public package exports of the local preview HTML renderer by name without
  exporting preview helper types (R-07, #2362).

- `fix(bot)`: extract GitHub Checks posting into a dedicated source adapter
  with project headers, explicit ESM imports, and payload-safe failure logging
  (R-10, #2328).

- `test(bot)`: add R-10 source-contract coverage for GitHub Checks helper and
  poster adapter headers, ESM imports, Zod-derived input typing, and
  payload-safe logging (#2328).

- `test(bot)`: add R-09 scaffold coverage requiring GitHub App manifest
  `checks: write` while preserving narrow existing bot permissions (#2327).

- `test(bot)`: add R-08 MSW coverage for GitHub Checks creation and the
  thin-adapter descriptor contract (#2326).

- `feat(bot)`: post Sovri GitHub Check runs after review posting on a
  best-effort basis, logging `checks.create` failures without failing the
  webhook flow (R-06, #2324).

- `test(bot)`: add ATDD coverage for best-effort GitHub Checks posting when
  `checks.create` rejects, including delivery, repository, and pull request log
  context (R-06, #2324).

- `test(bot, review-engine)`: add ATDD coverage that GitHub Check descriptor
  titles, summaries, and posted output omit GitHub tokens, LLM keys, and raw
  webhook payloads (R-07, #2325).

- `test(review-engine)`: add ATDD coverage proving the GitHub Checks
  license-scan row stays a neutral v1.0 placeholder and does not wire a SARIF
  reader or license scanner command (R-05, #2323).

- `feat(review-engine)`: map the `Sovri / provenance` GitHub Check
  conclusion to `success` when a signed audit entry is attached while keeping
  missing audit evidence neutral (R-04, #2322).

- `test(review-engine)`: add ATDD coverage for the GitHub Checks provenance
  conclusion, including successful signed audit evidence and the neutral
  missing-audit case (R-04, #2322).

- `test(review-engine)`: add ATDD coverage proving GitHub Checks descriptor
  mapping is deterministic for identical inputs and independent of wall-clock
  time (R-03, #2321).

- `feat(review-engine)`: map the `Sovri / review` GitHub Check conclusion
  from the validated review verdict (`approve`, `comment`,
  `request-changes`) (R-02, #2320).

- `test(review-engine)`: add ATDD coverage for GitHub Checks review
  conclusion mapping and unknown-verdict validation (R-02, #2320).

- `feat(review-engine)`: add the initial pure GitHub Checks descriptor mapper
  returning the three stable completed Sovri status rows (R-01, #2319).

- `test(review-engine)`: add ATDD coverage and the initial helper surface for
  the three stable Sovri GitHub Checks status rows (R-01, #2319).

- `test(review-engine)`: add ATDD coverage for the compliance provenance
  implementation quality contract, including Apache headers, explicit ESM
  imports, forbidden TypeScript escape-hatch and type-assertion guards,
  Zod-derived provenance typing, and Community package-boundary checks (R-11,
  #2304).

- `test(review-engine)`: add ATDD coverage for empty-review compliance block
  behavior, including omission without provenance and provenance evidence
  rendering for clean reviews that include provenance, with the composer now
  preserving provenance-only evidence blocks (R-10, #2303).

- `test(review-engine)`: add ATDD coverage for secret-safe compliance
  provenance output, ensuring non-provenance secret-shaped fields are ignored
  while signed audit-entry identifiers still render (R-09, #2302).

- `test(review-engine)`: add ATDD coverage for GitHub-safe compliance and
  provenance markdown, including provenance-present rendering without CSS hooks
  and escaping of user-influenced compliance strings (R-08, #2301).

- `test(review-engine)`: add ATDD coverage for walkthrough provenance payload
  validation, including malformed prompt digests, empty hosting/residency values,
  a complete valid payload, and field-specific failure paths preserved at the
  walkthrough boundary (R-07, #2300).

- `test(review-engine)`: add ATDD coverage for signed audit-entry provenance
  rendering and the Community default when no signed trail is attached (R-06,
  #2299).

- `test(review-engine)`: add ATDD coverage for hosting and data-residency
  provenance lines, including omission when provenance is absent (R-05, #2298).

- `feat(review-engine)`: validate optional walkthrough provenance, thread
  orchestrated prompt SHA-256 digests into composed walkthroughs, select the
  response-producing retry prompt digest for partial reviews, and render supplied
  hosting, residency, and signed audit-entry provenance with the
  no-signed-audit-trail default (R-04, #2297).

- `test(review-engine)`: add ATDD and integration coverage for prompt SHA-256
  provenance rendering, audit-backed prompt digest threading, supplied
  provenance fields, corrective retry prompt digest selection, and the
  no-signed-audit-trail default when provenance is absent (R-04, #2297).

- `feat(review-engine)`: render the review provider and model in the compliance
  provenance block with markdown escaping (R-03, #2296).

- `test(review-engine)`: add ATDD coverage for the compliance provenance model
  line, including escaped provider and model values (R-03, #2296).

- `test(review-engine)`: add ATDD coverage for compliance reference lines
  rendering framework labels, identifiers, descriptions, applicability
  conditions, and no-fabrication behavior when references are absent (R-02,
  #2295).

- `feat(review-engine)`: render non-empty compliance output inside a
  default-collapsed GitHub `<details>` block while preserving the existing
  compliance content order (R-01, #2294).

- `test(review-engine)`: add ATDD coverage for rendering the compliance and
  provenance block as default-collapsed GitHub `<details>` markup without styled
  container attributes (R-01, #2294).

- `test(review-engine)`: add ATDD coverage for the inline renderer quality
  contract, including shared helper imports, package headers, TypeScript escape
  hatch guards, Zod validation boundaries, and no I/O/log/env expansion (R-08,
  #2282).

- `test(review-engine)`: add ATDD coverage proving the inline refresh preserves
  existing draft schema validation, anchoring filters, and the committable
  single-line suggestion guard (R-07, #2281).

- `test(review-engine)`: add ATDD coverage proving refreshed inline finding
  comments stay GitHub-safe markdown with plain emoji badge labels, no local CSS
  vocabulary, and committable suggestions as markdown fences (R-06, #2280).

- `test(review-engine)`: add ATDD coverage proving refreshed inline finding
  comments keep the reconcile marker as the final line and extract the final
  fingerprint even when the body contains marker-like text (R-05, #2279).

- `test(review-engine)`: add ATDD coverage proving refreshed inline finding
  comments preserve exact committable GitHub suggestion block rendering after
  the body and before the reconcile marker (R-04, #2278).

- `test(review-engine)`: add ATDD coverage proving refreshed inline findings
  render a present audit reference exactly once through the shared helper and
  keep it immediately before the reconcile marker (R-03, #2277).

- `test(review-engine)`: add ATDD coverage proving refreshed inline finding
  comments keep the bold title on its own line after the badge prefix, followed
  by a blank separator and the verbatim finding body (R-02, #2276).

- `fix(review-engine)`: clarify assessment effort-score heuristic thresholds in
  public documentation and keep walkthrough type exports alphabetized after PR
  review feedback (#2272).

- `test(review-engine)`: add ATDD coverage for the review assessment module
  quality contract, including public header and ESM import checks, forbidden
  TypeScript escape-hatch guards, no I/O/log/env or secret-bearing helper output,
  and rejection of invalid external review input before assessment rendering
  (R-09, #2262).

- `test(review-engine)`: add ATDD coverage for GitHub-safe review assessment
  markdown, including canonical walkthrough placement after the verdict header
  and guards against CSS, stripped attributes, external stylesheets, and local
  preview vocabulary, with a regression guard for multi-character HTML tags
  (R-08, #2261).

- `feat(review-engine)`: add ATDD coverage for the review assessment block,
  including severity legend filtering and ordering plus an explicit empty-state
  line without distribution markup, exported from the walkthrough barrel and
  package root, documented as a public helper, and inserted into composed
  walkthrough markdown (#2260).

- `feat(review-engine)`: add ATDD coverage for the assessment severity
  distribution renderer, including total count, per-severity counts, and a
  GitHub-safe unicode block bar whose legend keeps raw integer counts visible
  while exporting the helper from the walkthrough barrel and package root (#2259).

- `feat(review-engine)`: add ATDD coverage for assessment metric chips that
  summarize finding count, distinct touched files, and blocker plus major findings
  without rereading the findings table, exported from the walkthrough barrel and
  package root (#2258).

- `feat(review-engine)`: add ATDD coverage for the GitHub-safe effort meter
  renderer that maps effort scores `1..5` to exactly five text dot glyphs
  (`●`/`○`) without HTML or CSS, exported from the walkthrough barrel and
  package root (#2257).

- `test(review-engine)`: add ATDD endpoint-case coverage for the review
  assessment effort score: zero findings stay at score `1`, and any blocker
  finding keeps the score fixed at `5` even with volume or confidence bonuses
  present (#2256).

- `feat(review-engine)`: extend the review assessment effort-score contract with
  ATDD coverage for the resolved severity, volume, confidence, and clamp
  heuristic. The score remains deterministic and closed over `1..5`, with
  confidence bonus inclusion at `0.85`; the implementation now applies the
  matching pure helper logic in `review-engine` and preserves the inclusive
  boundary for mixed confidences whose mathematical average is `0.85` (#2255).

- `feat(review-engine)`: add the deterministic review assessment effort-score
  helper with ATDD coverage for repeated-call purity, independence from
  clock/env/random changes, and the closed `1..5` score range. The helper is
  exported from both the walkthrough barrel and the package root, and documents
  its current R-01 severity-rank behavior (#2254).

- `chore(tooling)`: add `.fallowrc.jsonc` resolving the remaining Fallow false
  positives (#2246) — declare the two CLI entry-point scripts
  (`scripts/check-licenses.mjs`, `scripts/validate-v0-1-soak.mjs`), which are run
  via `node`/subprocess and never imported, and ignore the string-referenced
  `pino-pretty` Pino transport dependency. Fallow now reports zero issues.

- `test(llm-providers)`: lock the Mistral structured error contract. The
  `status`, `requestId`, `attemptDurationsMs`, `issues`, `tokenUsage`, and
  `retryableWithCorrectivePrompt` fields are populated dynamically (the
  `response.ts` schema-validation path, parity with the OpenAI/Anthropic
  providers) but had no reader, so Fallow flagged them as unused class members.
  Rather than delete live contract fields, assert them directly on
  `MistralProviderError` and the retry/timeout errors, and extend the
  schema-invalid provider test to assert the `issues` /
  `retryableWithCorrectivePrompt` / `tokenUsage` fields the `response.ts` path
  forwards into the thrown error, so the wiring itself is guarded (#2246).

- `feat(review-engine)`: add GitHub-safe badge helpers in
  `walkthrough/badge.ts` — `severityBadge` (brand glyph alone), `categoryBadge`
  (`glyph + label`), and `renderAuditReference` (the
  `\n\n🔍 Audit Reference: <ref>` line when present, `""` otherwise, mirroring
  `inline.ts`). Glyphs/labels read only from `@sovri/brand`; pure, deterministic,
  no CSS (ADR-016). Re-exported from `walkthrough/index.ts` and the package root.
  This is the shared badge vocabulary the v0.5 walkthrough/assessment/inline
  renderers (tasks 118-120) consume.
- `feat(brand)`: extend `categoryPalette` / `CategoryEntrySchema` with a
  per-category `glyph` emoji (🐛 bug, 🔒 security, ⚡ performance, 🔧
  maintainability, 🎨 style, 📝 documentation, 🧪 test-coverage), symmetric with
  the existing severity `glyph`, so `categoryBadge` sources both glyph and label
  from the brand single source.

- `feat(brand)`: add the `@sovri/brand` leaf package — the typed, Zod-validated
  design system (`spacing`, `typeScale`, light/dark `colors`, `severityPalette`,
  `categoryPalette`) ported from the mockup tokens. Every export is deeply frozen
  (nested palette entries included) and validated at module load; the palettes stay exhaustive against the core
  `Severity`/`Category` enums. `zod`-only, no workspace runtime deps (ADR-015).

- `docs(adr)`: add ADR-015 (`@sovri/brand` design-system package), ADR-016 (bot
  review output is GitHub Markdown; CSS is a local snapshot harness), ADR-017
  (optional walkthrough provenance field), ADR-018 (GitHub Checks API as a bot
  output surface), and ADR-019 (OpenTelemetry deferred to v0.6, revising
  ADR-006).

### Fixed

- `test(review-engine)`: scan every cut release section in the syntax-sanity
  changelog scope test, not only `[Unreleased]` and the single most recent
  release, so a documented entry stays found in the section where it first
  landed after a later version is promoted above it at release time.

- `fix(review-engine)`: recognize every URL scheme, not just HTTP(S), when
  scanning preview fixtures for real repository identities, so an `owner/repo`
  path inside an `ssh://`/`git://` URL gets the same non-GitHub exemption as its
  HTTPS form (#2392).

- `fix(review-engine)`: make the preview escape-hatch scanner step over regex
  literals before stripping comments, so a `//` inside a regex body can no longer
  hide a forbidden `as any` later on the same line (#2392).

- `fix(review-engine)`: broaden rendered preview output validation to cover all
  GitHub token prefixes already rejected in preview fixture anonymization and
  validate generated HTML before it is written to disk (R-08, #2366).

- `fix(review-engine)`: refine rendered preview raw webhook body detection to
  parse JSON-shaped candidates instead of matching broad field-name lookaheads
  (R-08, #2366).

- `fix(review-engine)`: detect double-escaped JSON quote entities when scanning
  rendered preview output for raw GitHub webhook payload bodies (R-08, #2366).

- `fix(review-engine)`: track JSON string state when collecting rendered preview
  payload candidates so a `}` inside a string field no longer bypasses raw
  webhook body detection, and normalize hex quote entities (`&#x22;`,
  `&amp;#x22;`) before parsing (R-08, #2366).

- `fix(review-engine)`: only track preview payload string state once a JSON
  candidate has started, so an unmatched prose quote before a raw webhook object
  no longer swallows its opening brace and bypasses detection (R-08, #2366).

- `fix(review-engine)`: emit every balanced JSON object, including nested ones,
  when scanning preview output, so a raw webhook payload wrapped inside a larger
  envelope is still detected (R-08, #2366).

- `fix(review-engine)`: extract each preview JSON object candidate independently
  from its opening brace, so a malformed prefix with an unclosed string can no
  longer desync the scan and hide a later payload (R-08, #2366).

- `fix(review-engine)`: recognize `issue_comment` webhook bodies (not just
  `pull_request`) when guarding rendered preview output, matching the events the
  bot subscribes to (R-08, #2366).

- `fix(review-engine)`: unescape backslash-escaped quotes when scanning preview
  output, so a webhook body serialized as a JSON string value (the common logged
  form) is still detected (R-08, #2366).

- `fix(review-engine)`: render preview golden snapshots from typed source
  fixtures through the walkthrough, inline, assessment, and provenance renderers
  instead of duplicating stored markdown lines, with an explicit fixture-renderer
  API contract and specific inline-preview count errors (#2342).

- `fix(bot, review-engine)`: address review feedback so failed reviews publish
  failing check conclusions, signed audit provenance feeds the provenance check,
  and missing descriptors skip best-effort checks without aborting review
  posting (#2339).

- `fix(bot)`: request GitHub App `checks: write` permission for the
  Community bot manifest without broadening existing repository scopes (R-09,
  #2327).

- `fix(bot, review-engine)`: attach GitHub Check descriptors to review-engine
  results and keep the bot adapter as a descriptor-posting pass-through (R-08,
  #2326).

- `fix(bot)`: derive the `Sovri / review` Check run conclusion from the
  unreconciled review findings so already-posted blocking findings cannot be
  hidden by reconciliation before check mapping (#2324).

- `fix(review-engine)`: format the one-finding GitHub Check summary as
  `1 finding found.` while keeping plural summaries for other counts (R-07,
  #2325).

- `test(bot)`: widen the repeated synchronize e2e fixture timeout to absorb CI
  variance after GitHub Check run posting was added (#2324).

- `fix(review-engine)`: trim optional free-text provenance fields before
  rendering and compute prompt SHA-256 digests from an unambiguous
  length-delimited prompt pair encoding (#2316).

- `fix(review-engine)`: include computed prompt SHA-256 provenance in failed
  review walkthroughs when provider responses are audited but still fail parsing
  after retry (#2316).

- `fix(review-engine)`: keep prompt-bearing failed provider walkthroughs on
  failure copy instead of rendering an approve verdict for empty failed reviews
  (#2316).

- `test(review-engine)`: assert token-bearing retryable schema failures render
  the audited prompt SHA-256 in failed walkthrough provenance (#2316).

- `fix(review-engine)`: remove the explicit crypto `Hash` import from prompt
  digest helpers and replace nested retry prompt digest selection with a named
  selector (#2316).

- `fix(review-engine, bot)`: keep prompt SHA-256 walkthrough provenance attached
  to generated reviews so reconciliation recomposition preserves the audited
  digest in posted walkthroughs (#2316).

- `fix(review-engine)`: document the prompt SHA-256 domain separator used by
  prompt digest provenance hashing (#2316).

- `test(review-engine)`: align compliance provenance test string construction
  style and remove redundant inferred finding annotation (#2316).

### Changed

- `feat(review-engine)`: refresh inline finding comment headers so the body
  starts with the shared severity and category badge prefix before the standalone
  bold title, preserving the existing body, audit reference, suggestion, and
  reconcile-marker contracts while updating review-engine fixtures and bot
  adapter expectations (#2275).

- `refactor(review-engine,bot,scripts)`: reduce Fallow health hotspots by
  splitting syntax scanning, CI policy checks, soak evidence parsing,
  compliance mapping validation, provider error shaping, and GitHub bot review
  helpers into smaller behavior-preserving units (#2248).

- `refactor(scripts)`: consolidate the duration-budget guard and result emitter
  in `ci-policy.mjs` — `guardNonNegativeElapsed` (the identical
  `--job-end-ms >= --job-start-ms` check across the four budget commands) and
  `emitDurationBudgetResult(statusKey, outcome, elapsedMs, format)` (the
  `measured_duration_ms / <statusKey> / reported_duration` pass/fail lines),
  clearing `dup:f1db16ab`. The special-case emissions (cache-miss, unsupported,
  build-docker cache-fail) keep their distinct field shapes inline. The broader
  ci-policy report-builder clones are left for a later pass. Verified by
  `scripts/ci-policy.test.sh` (414 cases) (#2247).

- `refactor(scripts)`: fold the qualifying-row scan shared by
  `findInvalidFindingCountPr`, `findInvalidLatencyPr` and
  `evaluateSoakLogQualityRatings` in `validate-v0-1-soak.mjs` into an
  `iterateQualifyingSoakLogRows` generator (`dup:ed29aaa7` / `5357d940`). The
  pre-filtered scanners (`findMissingRequiredSoakLogField`,
  `readSoakEvidenceRowPrNumbers`) keep their own row guards and are untouched.

- `test(review-engine)`: export the existing `extractVitestImports` helper from
  `test/vitest-api-style-policy.ts` and import it in `vitest-root-config.test.ts`,
  dropping the test-local copy (`dup:7c648746`). The return type widens to
  `ReadonlySet<string>`, which the consumers (spread + `.has()`) accept.

- `test(llm-providers)`: reuse the shared `mockOpenAIModule` / `captureError`
  test helpers (and the `FakeOpenAIChatClient` type) from
  `test/providers/OpenAICompatibleProvider.mock-helper.ts` in the OpenAI
  api-key-validation and base-url acceptance tests, dropping the inlined copies
  (`dup:b98789d1`). The provider-specific `fakeOpenAIClient` stub stays local.

- `refactor(bot)`: extract the review-comment helpers shared by the resolve
  handler and the issue-comment dispatcher into
  `apps/community-bot/src/github/review-comments.ts` —
  `listReviewCommentsOnAllPages` (raw paginated list, bot-login filtering left
  to callers), `hasFindingMarker` / `extractFindingId`, and
  `resolvePullRequestAuthorLogin` (throws via an injected `createError` factory
  so each caller keeps its own typed adapter error). Removes the duplicated
  pagination, author-lookup and finding-marker blocks
  (`dup:d9d97218` / `eb4bec7e` / `a5bd2842`). Behaviour-preserving (#2247).

- `refactor(llm-providers)`: hoist the identical `errorOptions(cause)` builder
  (repeated at the tail of `errors.ts`, `providers/OpenAIProvider.errors.ts`,
  `providers/MistralProvider.errors.ts`) into a shared internal
  `errors-internal.ts`. The flagged error-class constructor clones
  (`dup:3d7fdb2a` / `c0fe4ef7` / `a7d236c2`) are deliberately left: the
  per-provider field forwarding diverges (Mistral routes through
  `applyMistralErrorOptions` with `Object.defineProperty`, the others assign
  directly), so a shared extractor would need an unjustified cast (#2247).

- `refactor(llm-providers)`: extract the duplicated `isJsonObject` /
  `isStringArray` / `stringArray` JSON-value guards (byte-identical across
  `OpenAIProvider.schema-{matching,normalization,stripping}.ts`) into a shared
  internal `OpenAIProvider.schema-guards.ts` module, imported as runtime values
  (`verbatimModuleSyntax`). Scoped to the OpenAI schema triple (#2247).

- `refactor(review-engine)`: extract the duplicated `splitFilePatches` helper
  (byte-identical in `diff/filter.ts` and `diff/parser.ts`) into a shared
  internal `diff/split-file-patches.ts` module, imported relatively and kept out
  of the package barrel (mirrors the `right-side-lines.ts` sibling convention).
  First production clone removed from the Fallow duplication baseline (#2247).

- `docs(roadmap)`: realign the public roadmap so the BYOK productization sits in
  the v0.4 line, v0.5 becomes the public design sprint (design system + bot
  review-output rendering), and v0.6 covers observability and supply-chain
  hardening; update the README next-sprint note.

- `ci(release)`: align the README release reference policy and nominal fixture
  with the published v0.4.0 Community image tag.

- `feat(review-engine)`: the walkthrough summary now leads with a deterministic
  verdict header — `## ✅ Approve` / `## ❌ Request changes`, computed once by
  `computeVerdict` (request-changes when any finding is ranked at or above
  `major` — i.e. a `blocker` or `major` — otherwise approve, including reviews
  with only `minor`/`info`/`nitpick` findings or none) — placed above
  `### TL;DR` in front of the existing sections, with a one-line finding count
  that breaks the total down per occurring severity, in descending rank order.
  Replaces the static `## Sovri review`
  title. The `### Findings` section now renders as a single severity-badged
  table — one row per finding, the task-117 brand severity glyph
  (`severityBadge`) in the Severity column — in place of the per-severity
  grouped `#### ` tables, keeping the existing rank-then-file ordering.
  `WalkthroughInputSchema` validation at the boundary and the table-cell /
  markdown escaping of summary, titles, bodies, and file paths are preserved.
  An optional pipeline-flow diagram (`diff → prompt → LLM → findings`) renders
  under the verdict header as a single ```mermaid fence when enabled via the
  `pipelineFlow` option, and is off by default so existing snapshots stay
  byte-stable. The canonical section order (verdict header → TL;DR → Findings →
  File-by-file → compliance → cost footer) is preserved, and the banner/flow are
  GitHub-safe (headings, emoji, and ```mermaid fences only — no CSS class/style
  attributes, no `gh-chrome.css`). Adversarial finding content (e.g. an embedded
  `<style>`/`<script>`) is escaped to inert text rather than activated, and the
  composer sources no credential of its own — it reads no token, key, or
  environment, so it cannot leak one it was never given. (task-118, mockup §01)

### Removed

- `refactor`: tighten the public export surface by un-exporting internal-only
  symbols flagged dead by Fallow (#2246), with no behavior change. Dropped the
  `export` keyword on module-private helpers — `scanQuotedCharacter` /
  `scanRegexCharacter` / `scanNormalCharacter` (review-engine syntax scanner),
  `FLAGSHIP_CREDENTIALS_CWE_ID` (compliance), `MistralChatOptions` /
  `OpenAIChatOptions` (llm-providers retry), the `ForbiddenCompatibleNetworkPattern`
  test type, and `OperationalRouteError` (community-bot). Pruned redundant barrel
  re-exports that had no importer: `mapParsedDiffFiles` / `iterateRightSideLines`
  from `review-engine/diff/index.ts`, `ReviewPromptModeSchema` from
  `review-engine/prompt/index.ts`, and the `comment-poster` re-export block from
  `community-bot/github/index.ts`. All symbols remain available to their internal
  callers and tests via their defining module.

- `refactor`: un-export a second wave of internal-only symbols surfaced after
  re-running Fallow (#2246) — `RunReviewInputSchema` (orchestrator; the public
  `RunReviewInput` type still derives from it), `InlineSuggestionAnchorError`
  (review-engine, thrown internally), the `QuotedScanResult` / `RegexScanResult` /
  `NormalScanResult` / `DelimiterStackEntry` scanner result types (now that their
  scan helpers are internal), and `OpenAIChatComplete`. Pruned dead re-exports of
  `DiffFetchError` / `DiffFetchTimeoutError` (community-bot `diff-fetcher.ts`,
  classes still live in `diff-fetcher-contract.ts`) and of `OpenAIChatComplete` /
  `OpenAIChatRequest` (`OpenAIProvider.ts`). After this pass Fallow reports zero
  unused exports, types, class members, and dependencies.

- `chore(deps)`: drop the redundant direct `zod` declaration from `@sovri/config`
  and `@sovri/llm-providers`. Neither package imports `zod` directly — both consume
  `z` through `@sovri/core` (which re-exports it), so the direct dependency was an
  unused declaration flagged by Fallow. Removed via `pnpm remove`, lockfile updated.

### Fixed

- `test(review-engine)`: harden R-04 inline suggestion-block coverage by asserting
  the body text, GitHub suggestion fence, and reconcile marker are all present
  before comparing their order, with named fixtures for the single-line suggestion
  case (#2286).

- `fix(bot)`: break the re-review issue-comment import cycle by moving the
  shared bot-login resolver into `commands/shared-utilities`, reusing the
  shared repository-name parser, and keeping helper-only utilities internal.

- `fix(config)`: resolve `.sovri.yml` through an explicit in-repo path builder
  and containment check before any filesystem read, removing the path-traversal
  security candidate surfaced by Fallow.

- `fix(review-engine)`: post deterministic composed walkthrough markdown from the
  orchestrator success path instead of provider-supplied legacy markdown,
  recompose markdown and reset stale summaries after community-bot finding
  reconciliation, avoid redundant review revalidation during composition, make
  direct findings-table rendering sort rows by severity rank then file/line, add
  verdict-module JSDoc, and keep
  the community-bot E2E assertions aligned with the badged findings table.

## [0.4.0] - 2026-06-02
### Added

- `test(review-engine)`: allow the syntax-sanity scope acceptance test to read
  release-promoted changelog entries after `[Unreleased]` has been cut for a
  version tag, keeping the v0.4.0 release gate compatible with the documentation
  contract.

- `ci(deps)`: allow `Python-2.0` and `CC-BY-4.0` in the local license gate and
  Dependency Review workflow for existing transitive dev dependencies with
  permissive or metadata-only licensing.

- `feat(bot)`: route parsed `@sovri-bot resolve <findingId>` commands toward a
  dedicated resolve handler so PR authors can acknowledge handled findings
  without invoking dismiss suppression.

- `test(bot)`: add issue-comment dispatcher coverage for forwarding parsed
  `resolve <findingId>` commands with delivery, comment, author, and PR context.

- `feat(bot)`: implement resolve-command handling against GitHub review threads,
  including PR-author authorization, resolved-comment fallback, idempotent
  acknowledgement, and retry-safe failure reporting.

- `test(bot)`: add resolve-command handler coverage for thread resolution,
  unauthorized users, unknown findings, fallback minimization, idempotency, and
  hard GitHub failures.

- `test(bot)`: document the resolve-command handler test strategy for author
  gating, thread resolution, fallback, idempotency, and GitHub failure coverage.

- `test(bot)`: cover resolve-command retry handling when GitHub fails during pull
  request author lookup.

- `test(bot)`: assert successful resolve of an existing finding does not post a
  not-found or retry comment.

- `test(bot)`: cover resolve-command behavior when a human-authored comment
  contains Sovri finding marker text.

- `test(bot)`: cover resolve-command statelessness across the reachable handler
  helper graph, including arrow-function helpers, so manual resolution cannot
  introduce database, cache, queue, or dismissed-finding suppression stores.

- `test(bot)`: cover resolve acknowledgement idempotency when the bot already
  reacted to the issue-comment command.

- `test(bot)`: cover successful resolve logging so completion emits no failure
  log, posts no retry comment, and creates exactly one acknowledgement reaction.

- `test(bot)`: cover hard resolve-command GitHub failures during review-comment
  listing and acknowledgement reaction creation.

- `test(bot)`: cover resolve-command failure log safety so raw payloads and
  token-like secrets stay out of error bindings.

- `test(bot)`: cover resolve-command thread-resolution failure statelessness so
  failures post the retry message without scheduling retry timers.

- `refactor(bot)`: extract resolve-command handling into a dedicated Community
  source file with the required Apache 2.0 license header.

- `feat(review-engine)`: add a pure parsing source convention inspector for
  review-engine purity, TypeScript, and ESM boundary checks.

- `test(review-engine)`: add acceptance coverage for parsing source purity,
  TypeScript conventions, forbidden implementation pattern checks, multiline
  import, dynamic import and import-attribute edge cases, directive edge cases,
  and stable committable suggestion contracts.

- `test(review-engine)`: add acceptance coverage proving syntactically suspect
  suggestions keep their display text while the one-click committable gate rejects
  them.

- `feat(review-engine)`: committable suggestions use lightweight syntactic validation
  for balanced delimiters, quotes, and truncation markers without adding parser
  dependencies; template-literal interpolations, standalone ellipses, and
  unterminated block comments fail closed, and full AST validation is not included.

- `feat(bot)`: parse `@sovri-bot resolve <findingId>` as a distinct command
  kind using the existing finding-id validation rules.

- `test(bot)`: add command parser acceptance coverage for `@sovri-bot resolve
  <findingId>`, malformed resolve inputs, mention anchoring, and resolve/dismiss
  command distinctness.

- `feat(review-engine)`: render parser-approved inline fixes as GitHub
  `suggestion` fenced blocks on single-line inline anchors while keeping
  non-committable alternatives off the one-click surface and preserving
  audit-reference and marker ordering.

- `test(review-engine)`: add acceptance coverage for rendering committable
  suggestions as inline GitHub suggestion blocks while preserving non-committable,
  audit-reference, marker-last, and anchor-invariant behavior.

- `test(review-engine)`: add acceptance coverage for the deferred full-AST
  validation scope, parser-dependency boundaries, maintenance notes, and
  production-source language-boundary checks for committable suggestion syntax
  checks.

- `test(review-engine)`: add acceptance coverage proving syntactic sanity
  validation stays pure and language-agnostic without runtime evaluation hooks in
  production parsing sources.

- `test(review-engine)`: add expanded acceptance coverage for direct syntactic
  sanity validation of balanced, postfix-update, and uncertain single-line
  suggestions.

- `feat(review-engine)`: add a pure syntax sanity helper and parser gate so
  committable suggestions use lightweight syntactic validation with fail-closed
  token rules; full AST validation is not included.

- `feat(config)`: accept `review.mode: strict` in `.sovri.yml` so repository
  configuration reaches the strict review-engine prompt path for regulated
  codebase reviews that need maintainability, style, readability, and
  test-quality findings.

- `test(review-engine)`: add strict prompt acceptance coverage for the UTF-8
  byte budget, structured JSON contract, prompt-injection containment,
  prompt-module purity, and source-level Apache 2.0 / ESM conventions.

- `feat(review-engine)`: route `review.mode: strict` through the review
  orchestrator to the strict prompt template instead of silently falling back to
  full mode.

- `feat(review-engine)`: add the strict review system prompt template and route
  `buildSystemPrompt({ mode: "strict" })` to strict-mode guidance without changing
  the existing `full`, `bugs-only`, or `minimal` prompt templates.

- `feat(review-engine)`: accept `strict` as a review prompt mode in the prompt
  builder schema, preparing prompt routing for the v0.5 strict review mode.

- `test(review-engine)`: add acceptance coverage proving `strict` is a first-class
  prompt mode in the review prompt schema while unsupported prompt modes still fail
  at the `mode` field.

- `fix(config)`: allow slash-delimited OpenAI-compatible model identifiers, such as
  Hugging Face-style endpoint model IDs, while preserving the config model character
  boundary against control characters.

- `test(llm-providers)`: cover the provider factory error path when
  `openai-compatible` config omits the required `llm.baseUrl`.

- `test(config)`: assert OpenAI provider config accepts every supported review
  mode, including end-to-end `.sovri.yml` parsing for `strict` mode.

- `test(config)`: pin the `ProviderSchema` enum contract to Anthropic, Mistral,
  OpenAI, and OpenAI-compatible provider values.

- `test(config)`: cover OpenAI `apiKeySecret` values with neutral
  environment-variable names and reject non-env-var strings, preserving the BYOK
  contract that config stores secret references rather than literal credentials.

- `test(config)`: pin `llm.baseUrl` HTTPS validation and the 2048-character
  boundary for OpenAI-compatible configuration.

- `test(config)`: cover OpenAI base URL optionality separately from
  OpenAI-compatible's required `llm.baseUrl` rule.

- `test(config)`: assert OpenAI-compatible configs that omit `llm.baseUrl` fail on
  `llm.baseUrl` without reviving the provider allow-list error.

- `test(config)`: add acceptance coverage for the v0.5 provider allow-list so
  `.sovri.yml` accepts Anthropic, Mistral, OpenAI, and OpenAI-compatible provider
  values while still rejecting providers outside the declared enum.

- `feat(config)`: widen `.sovri.yml` provider validation to accept `openai` and
  `openai-compatible` alongside Anthropic and Mistral.

- `feat(config)`: require `llm.baseUrl` at validation time when
  `llm.provider` is `openai-compatible`.

- `feat(llm-providers)`: wire the shared provider factory to construct OpenAI and
  OpenAI-compatible adapters from accepted `.sovri.yml` provider configuration.

- `feat(llm-providers)`: add the OpenAI provider contract implementation slice, covering
  the public `LLMProvider` metadata, default model, data-only generation, and token-usage
  generation expected from the v0.5 BYOK OpenAI adapter.

- `test(llm-providers)`: cover OpenAI provider option validation, request shaping, schema
  failures, and malformed response handling with injected fake clients so the adapter stays
  above the package coverage gate without real network calls.

- `test(llm-providers)`: add grouped acceptance coverage for OpenAI schema validation,
  including response-format derivation, retryable Zod validation failures, and unsupported
  schema preflight rejection.

- `test(llm-providers)`: add grouped acceptance coverage for OpenAI API key validation,
  including blank-key typed errors before requests and trimmed SDK constructor options.

- `feat(llm-providers)`: add bounded OpenAI numeric options for timeout and retry-attempt
  configuration alongside the existing max-token validation.

- `fix(llm-providers)`: cap OpenAI retry attempts to keep exponential backoff bounded.

- `feat(llm-providers)`: support optional OpenAI constructor base URL overrides for EU-hosted or
  OpenAI-compatible endpoints while preserving the SDK default when omitted.

- `test(llm-providers)`: add grouped acceptance coverage for OpenAI token-usage mapping,
  invalid usage diagnostics, and data-only generation.

- `test(llm-providers)`: add OpenAI provider no-network guards for forbidden real API
  dependencies and accidental unhandled OpenAI requests in tests.

- `feat(llm-providers)`: export typed OpenAI retry and timeout errors from the package
  entrypoint alongside the provider and default constants.

- `fix(llm-providers)`: normalize OpenAI strict JSON schemas before requests, reject
  unsupported dynamic record schemas, and wrap SDK transport/authentication failures in
  typed provider errors with request metadata.

- `chore(deps)`: add the official `openai@6.39.1` SDK as an exactly pinned runtime dependency
  of `@sovri/llm-providers`, preparing the v0.5 BYOK provider slice for OpenAI and
  OpenAI-compatible adapters while keeping this task limited to supply-chain-gated dependency metadata.

- `fix(llm-providers)`: address OpenAI provider review feedback by validating base URLs and
  temperature values before requests, preserving optional-field semantics in strict OpenAI JSON
  schemas, and hardening the no-network test guard against formatting bypasses.

- `fix(llm-providers)`: make the OpenAI no-network guard use a CodeQL-safe host matcher while
  preserving case-insensitive detection of forbidden real OpenAI API dependencies.

- `fix(llm-providers)`: handle OpenAI optional null sentinels inside union schema branches and
  optional enum schemas, rewrite literal/one-of schema keywords for OpenAI strict structured
  outputs, reject unsupported all-of schemas before requests, preserve caller-allowed null values,
  complete SDK mock exports, clarify provider validation and default-option comments, and document
  the typed OpenAI provider error hierarchy.

- `feat(llm-providers)`: add the OpenAI-compatible provider construction helper for BYOK
  deployments that route reviews through self-hosted or EU-hosted OpenAI-compatible gateways,
  covering `provider: openai-compatible`, required `baseUrl`, optional `model`, distinguishable
  provider metadata, and no fallback to the public OpenAI endpoint.

- `test(llm-providers)`: add OpenAI-compatible protocol parity coverage proving structured-output
  request shaping, retryable schema errors, and transient retry behavior stay shared with the
  OpenAI provider path.

- `test(llm-providers)`: add OpenAI-compatible provider metadata coverage so logs and audit events
  can distinguish compatible endpoints from the public OpenAI provider before and after generation.

- `test(llm-providers/config)`: add OpenAI-compatible HTTPS base URL boundary coverage, proving
  config validation rejects non-HTTPS URLs before provider construction, records the current
  `openai-compatible` config gate explicitly, and proves the compatible helper passes accepted
  HTTPS URLs unchanged to the OpenAI SDK constructor so future compatible endpoints cannot
  accidentally route review data over plaintext transport or through SDK default endpoints.

- `test(llm-providers)`: add OpenAI-compatible token-usage parity coverage for valid usage,
  invalid usage diagnostics, and data-only generation so compatible endpoints keep the same
  structured-output contract as the OpenAI provider.

- `test(llm-providers)`: add OpenAI-compatible no-network guards that require injected fake
  clients, reject public OpenAI host and real API-key environment lookups in compatible provider
  tests including bracketed and destructured env-key references, and prove missing compatible
  baseUrl fails before SDK construction with explicit guard scope, grouped fixture constants, and
  same-test detection across `it` and `test` blocks for inline, variable, and helper compatible
  provider options without a top-level fake client or mocked OpenAI SDK.

- `test(llm-providers)`: add OpenAI-compatible package export and quality acceptance coverage,
  proving the public barrel exposes the compatible helper and options type, source files keep SPDX
  headers and explicit ESM extensions, forbidden TypeScript escape hatches are named, and the
  entrypoint helper constructs an `LLMProvider` with an injected fake client while remaining under
  the compatible no-network guard.

- `fix(llm-providers)`: address OpenAI-compatible review feedback by making the missing-baseUrl
  no-network guard exercise SDK-construction prevention without an injected client, sharing
  compatible provider test helpers across base URL, metadata, and no-network suites, clarifying
  metadata comments, preserving the missing-usage sentinel type in token-usage fixtures, and
  documenting compatible-endpoint adoption details in the changelog.

- `fix(llm-providers)`: reject non-HTTPS OpenAI-compatible `baseUrl` values at the direct provider
  helper boundary before OpenAI SDK construction, matching the config-layer HTTPS contract.

- `test(llm-providers)`: move OpenAI-compatible export, SDK mock, and no-network guard helpers into
  package test utilities, document the direct provider helper HTTPS `baseUrl` constraint, and name
  repeated compatible-provider token and default-limit test fixtures.

### Fixed

- `fix(bot)`: add safe structured pull-request review failure diagnostics with
  failure-stage, error-type, provider, token, and review metadata while keeping
  public failure comments generic and avoiding raw failed-review content in logs.

- `fix(bot)`: resolve `@sovri-bot resolve <findingId>` against the matching
  review comment node so stale resolved threads cannot receive the acknowledgement
  while the active finding remains open.

- `fix(bot)`: avoid duplicate resolve acknowledgement reactions by checking
  existing issue-comment `+1` reactions before creating one.

- `fix(bot)`: exclude resolved GitHub review threads from active posted-finding
  reconciliation, with adapter rationale documented, so manually resolved
  findings can reappear on later re-review.

- `fix(review-engine)`: detect CommonJS loads and bare specifiers for forbidden
  Node.js modules, dynamic relative imports with options, generic `any` type
  arguments, direct `any` type aliases, and generic `any` type aliases in parsing
  source convention checks.

- `fix(review-engine)`: reject syntactically suspect single-line suggestions from
  the one-click committable path while preserving their suggestion text for review
  rendering, balanced template interpolation, valid spread operands, and terminal
  operator rejection.

- `fix(bot)`: react `confused` to parsed `@sovri-bot resolve <findingId>`
  issue comments in the pre-handler phase, avoiding silent dispatcher no-ops.

- `refactor(bot)`: share GitHub command helper utilities between dismiss and
  resolve command handlers so repository parsing, duplicate-reaction detection,
  marker extraction, and typed GitHub status handling stay consistent.

- `fix(review-engine)`: wire provider `suggested_code` through review findings
  before inline comments are posted, and size GitHub suggestion fences around
  replacement code that already contains backticks.

- `fix(review-engine)`: address syntax-sanity review feedback for line comments,
  truncated ternaries, non-null assertions before delimiters, Unicode regex flag
  suffixes, adjacent quoted literals, tagged template literals, empty ternary
  arms, JSX closing and attributed opening tags, member-access keyword properties,
  `as const` assertions, Rust path separators, Python slices with omitted bounds
  while rejecting array-literal and ternary false-arm lookalikes, dangling
  greater-than operators, dangling non-operand and control keywords, statement
  terminators after incomplete expressions, JSX text content and quoted-attribute
  boundaries, incomplete JSX attributes, `do` / `while` continuations, scoped JSX
  expression text handling, leading and repeated delimiter commas while
  preserving valid array elisions, and scope-test false positives.

- `fix(review-engine)`: align strict prompt guidance with the configured severity
  filter by requesting blocker, major, and minor findings instead of nitpick
  findings that the default `minor` threshold removes.

## [0.3.0] - 2026-05-31

### Changed

- `chore(release)`: prepare the v0.3.0 release metadata — the Compliance Trail
  foundation ships in the Community edition (`@sovri/compliance` mapping plus the
  Ed25519 audit trail), with the audit-trail sink inert by default. Cosign
  signing remains deferred to v0.5.

### Added

- `feat(bot)`: make `.sovri.yml` optional via deployment-level LLM defaults — `SOVRI_DEFAULT_LLM_PROVIDER`,
  `SOVRI_DEFAULT_LLM_MODEL`, and `SOVRI_DEFAULT_LLM_API_KEY_SECRET` configure a default provider once for a
  self-hosted bot, used when a repository has no (or an empty) `.sovri.yml`; documented in
  `docs/deployment-configuration.md` (#1959)
- `ci(review-engine)`: enforce the `@sovri/review-engine` branch coverage gate at >= 85 % in the
  `backend-checks` CI job (via `scripts/check-coverage.mjs`), alongside the `@sovri/llm-providers` and
  `@sovri/compliance` gates, so the diff, prompt, parsing and audit code paths added in v0.3 cannot
  regress below their coverage floor (task-103)

- `ci(compliance)`: enforce the `@sovri/compliance` branch coverage gate at >= 90 % in the
  `backend-checks` CI job (via `scripts/check-coverage.mjs`), mirroring the existing
  `@sovri/llm-providers` gate, so the v0.3 Compliance Trail package cannot regress below its
  coverage floor (task-103)

- `docs(adr)`: record ADR-013 (Compliance Trail as primary differentiator) and ADR-014
  (Ed25519 hash-chain audit trail), both accepted 2026-05-27 — ADR-013 makes the Compliance
  Trail Sovri's product distinction for regulated EU buyers, and ADR-014 defines the
  offline-verifiable, append-only audit trail signed with a per-entry SHA-256 hash chain and
  Ed25519 signatures and no proprietary verification service (task-102)

- `test(docs)`: add a failing acceptance test (`tests/changelog.docs.test.ts`) pinning the
  `[Unreleased]` section to Keep a Changelog 1.1.0 — a single `Added` category, a Conventional
  Commit prefix on every entry in any category — types drawn from the allowed list in
  `CONTRIBUTING.md`, with type-only leads and slashed scopes accepted — the
  required v0.3 scopes present under `Added` (`feat(compliance)`, `feat(core)`,
  `feat(review-engine)`, `docs(adr)`), no references to unversioned internal docs, and a
  self-sufficient summary per `Added` entry (task-102, #1968)

- `feat(review-engine)`: wire an optional audit-trail sink into `reviewPullRequest`
  (task-100, #1957) — `ReviewPullRequestOptions` gains optional `auditTrailSink?` and
  `strictAudit?`. With a sink injected, the orchestrator emits unsigned
  `AuditTrailLogicalEvent`s: `review.started`, a single `llm.called` once the model
  responded — including a response the provider rejected for invalid output, even when
  every attempt fails (detected via the token usage carried on the error), so a charged
  call is never dropped from the trail — (carrying a SHA-256 `prompt_hash` and tokens
  aggregated across the retry), one `finding.created` per final finding (with the finding's
  `audit_reference`, `severity`, optional `cwe`, and `framework:identifier` compliance
  references), then `review.completed` or `review.failed`. It
  never emits `trail.started`, which stays the Cloud wrapper's job (it owns the
  Ed25519 key and `trail_id`). `review.failed` carries an `error_code` from a fixed
  taxonomy (`limit_exceeded`, `provider_error`, `parse_error`, `unexpected_error`) and a
  fixed, content-free `error_message` per code — raw provider or exception text (which
  can echo prompt or diff content) is never written to the signed trail, only to the
  returned Review and the logs; a propagated exception is re-thrown after the
  event is recorded, so caller-visible behavior is unchanged. A sink whose `append()`
  rejects is logged and never blocks the review, and `strictAudit` is accepted as a
  no-op in v0.3. Without a sink, behavior and overhead are unchanged; the Community
  bot injects none.

- `chore(config)`: add the repository-level `.sovri.yml` used by Sovri's own
  PR reviews, selecting the Mistral provider through the `MISTRAL_API_KEY`
  runtime environment variable and applying standard review limits/ignores.

- `feat(compliance)`: add the offline audit-trail verifier (task-99, #1952) —
  `verifyAuditTrail(entries, publicKey)` validates a `SignedAuditTrailEntry[]` offline with no I/O
  and returns a discriminated-union `VerifyResult` (`{ valid: true }`, or `{ valid: false, failAt,
  reason }` at the first failing entry, where `reason` is one of `previous_hash mismatch`,
  `entry_hash mismatch`, `signature invalid`). Each entry runs three checks in a fixed order —
  hash-chain (null anchor on the first entry, then `previous_hash[N] === entry_hash[N-1]`),
  `entry_hash` recompute over the same canonical the signer hashes (`previous_hash` included, only
  `entry_hash` + `signature` excluded), and the Ed25519 `signature` over the `entry_hash`, which is
  accepted only as a canonical `ed25519:<base64url>` encoding of the 64-byte signature (a missing
  prefix, padding, stray characters, or a re-encoded suffix are rejected) — stopping at the first
  failure. Exported from `@sovri/compliance` so an external auditor can confirm a trail without
  trusting Sovri's servers.

- `feat(compliance)`: add the internal file-backed audit-trail writer (task-98, #1947) —
  `createFileAuditTrailWriter(filePath, signer)` returns an `AuditTrailSink` whose `append()`
  signs each unsigned `AuditTrailLogicalEvent` through the injected signer and appends the
  resulting `SignedAuditTrailEntry` as one JSONL line (`JSON.stringify(entry) + "\n"`) in append
  mode, so existing entries are never rewritten. The `previousHash` is held in a closure (null
  for the first entry, advanced after each successful write) so consecutive lines chain by hash;
  a failed disk write propagates to the caller and leaves the chain un-advanced. All signing is
  delegated to the injected signer, so the writer holds no key material, and appends must be
  serialised — the closure head is read at the start of each `append`. Internal in v0.3: not
  exported from `@sovri/compliance`, reserved for the Cloud writer.

- `feat(compliance)`: add the internal Ed25519 audit-trail signer (task-97, #1942) —
  `createSigner(privateKey)` returns `(event, previousHash) => SignedAuditTrailEntry`. It
  hashes the canonical JSON of the logical event plus its `previous_hash` (`entry_hash =
  "sha256:" + sha256(canonical)`, excluding only `entry_hash` and `signature`) and signs
  that hash with Ed25519 through `node:crypto` (`signature = "ed25519:" + base64url(...)`).
  Folding `previous_hash` into the signed content makes deletion and reordering of entries
  tamper-evident. The input event is re-parsed against `AuditTrailLogicalEventSchema` before
  hashing, so stray `entry_hash` / `signature` fields can never leak into the canonical, and
  the assembled entry is validated against `SignedAuditTrailEntrySchema` before return, forcing
  a first entry (`trail.started`) to carry a null `previous_hash`.
  Internal in v0.3: not exported from `@sovri/compliance`, reserved for the Cloud writer to
  keep the attack surface small.

- `feat(compliance)`: add the in-memory `AuditTrailSink` (task-96, #1937) —
  `AuditTrailSink` is the orchestrator-facing port (`append(event): Promise<void>`) and
  `MemoryAuditTrailSink` stores unsigned `AuditTrailLogicalEvent`s for orchestrator tests.
  `append()` re-validates each event against `AuditTrailLogicalEventSchema` and rejects
  malformed input — including any event carrying `previous_hash` / `entry_hash` /
  `signature` — without storing it; `getEvents()` returns a defensive deep copy in insertion
  order (neither the array nor its events alias the stored trail). Signing stays in the file
  writer (task-98). Both are exported from `@sovri/compliance`.

- `feat(compliance)`: harden audit-trail field validation to match the core review
  contract (task-95, #1932) — `review.started.pr_id` is a positive integer, `commit_sha`
  is a 40-char hex sha, `llm.called.tokens_in` / `tokens_out` are non-negative integers,
  the `trail.completed` seal `entry_count` is a positive integer, and a signed entry's
  `previous_hash` is non-null except for the first entry (`trail.started`), whose
  `previous_hash` is exactly `null`. Addresses the Codex and CodeRabbit review notes on
  #1932.

- `feat(compliance)`: add the ADR-014 `trail.completed` seal to
  `SignedAuditTrailEntrySchema` (task-95, #1933) — a signed-only 8th variant carrying
  `entry_count` (a positive integer) plus the chain/signature fields. The seal is not
  an `AuditTrailLogicalEvent` (the logical union stays at 7 types) and is rejected by
  `AuditTrailLogicalEventSchema`. Addresses the Codex review note on #1931.

- `feat(compliance)`: add audit trail event Zod schemas (task-95, #1930) —
  `AuditTrailLogicalEventSchema` is a strict `z.discriminatedUnion` over the 7 logical
  event types (`trail.started`, `review.started`, `llm.called`, `finding.created`,
  `review.completed`, `review.failed`, `correction`), and `SignedAuditTrailEntrySchema`
  adds the writer's `previous_hash` (nullable for the first entry), `entry_hash` and
  `signature`. Strict objects reject raw payloads (prompt / diff / token / body /
  webhook) and a `correction` `decision` field; `finding.created` reuses `@sovri/core`
  `SeveritySchema` and validates the `SOVRI-XX-HHHH-HHHH` audit reference and `CWE-N`.
  Both schemas and their inferred types are exported from `@sovri/compliance`.

- `test(compliance)`: add a failing acceptance test for the audit trail event Zod
  schemas (task-95, #1930) — `AuditTrailLogicalEventSchema` (7 discriminated logical
  event types: `trail.started`, `review.started`, `llm.called`, `finding.created`,
  `review.completed`, `review.failed`, `correction`) and `SignedAuditTrailEntrySchema`
  (logical event + `previous_hash` / `entry_hash` / `signature`), with strict payload
  hygiene and public exports from `@sovri/compliance`.

- `feat(review-engine)`: append a `🔍 Audit Reference` line to each inline PR comment
  (task-94, #1925) — `buildInlineComments()` now appends `🔍 Audit Reference: {audit_reference}`
  as the last line of every inline comment body (separated by a blank line); an undefined
  `audit_reference` adds no line (unlike the walkthrough's `n/a` placeholder), and the
  `📋 Potential compliance references` tree stays walkthrough-only.

- `test(review-engine)`: add a failing acceptance test for the inline comment audit
  reference line (task-94, #1925) — each inline comment must append a `🔍 Audit Reference`
  line as its last line (separated by a blank line); an undefined `audit_reference` adds
  no line; the `📋 Potential compliance references` tree stays walkthrough-only.

- `chore(review-engine)`: drop an internal-doc reference from a walkthrough test
  comment so the public Apache surface carries no dead link.

- `feat(review-engine)`: render a `🔍 Audit Reference` line for every finding in the
  walkthrough `### Compliance & audit` section (task-93, #1919) — the section now
  lists all findings (not only those with compliance references), each with its audit
  reference and an `n/a` placeholder when `audit_reference` is undefined; the `📋`
  references tree stays conditional and the section is still omitted for empty reviews.

- `test(review-engine)`: add failing acceptance test for the per-finding audit
  reference line (task-93, #1919) — every finding must render a `🔍 Audit Reference`
  line (incl. ref-less findings), with an `n/a` placeholder when `audit_reference`
  is undefined.

- `feat(review-engine)`: render a `### Compliance & audit` walkthrough section
  (task-93, #1918) — `composeWalkthrough()` now appends, for each finding carrying
  `compliance_references`, the `📋 Potential compliance references` tree (`├─`/`└─`)
  with human-readable framework labels, `applicable_if` conditions in parentheses,
  and a `🔍 Audit Reference` line; the section is omitted only when the review has
  no findings.

- `test(review-engine)`: add failing acceptance test for the walkthrough compliance
  references block (task-93, #1918) — `composeWalkthrough()` must render a
  `### Compliance & audit` section with the `📋 Potential compliance references`
  tree (`├─`/`└─`), human-readable framework labels, `applicable_if` conditions in
  parentheses, and the `🔍 Audit Reference` line per finding.

- `feat(review-engine)`: wire compliance enrichment and audit references into the
  orchestrator — `reviewPullRequest()` now propagates the provider `cwe`, stamps
  each LLM-derived finding with an `audit_reference`, and fills its
  `compliance_references` via `enrichFindingCompliance()`; on enrichment failure
  the finding degrades to empty references with a logged error and the review
  still completes. Adds `@sovri/compliance` as a workspace dependency.

- `test(review-engine)`: assert the R-07 enrichment-failure test against the
  compliance-specific error message, so it cannot pass on an unrelated error log.

- `test(review-engine)`: add MSW integration coverage for compliance wiring in
  `reviewPullRequest()` — a finding with a mapped `cwe` (`CWE-798`) gains an
  `audit_reference` and its compliance references, a finding without a `cwe` or
  with an unmapped one keeps empty references, and every LLM-derived finding in
  the returned `Review` carries an `audit_reference`.

- `feat(review-engine)`: accept an optional `cwe` (`/^CWE-\d+$/`) on the
  provider finding schema (`ProviderFindingSchema`), so an LLM provider may hint
  a CWE on the hot path used by `reviewPullRequest()`; the derived
  `ProviderFinding` type gains `cwe?: string`. The strict schema still rejects
  any model-supplied `compliance_references`.

- `test(review-engine)`: add acceptance coverage for an optional `cwe` on the
  provider finding schema — a valid `CWE-798` is accepted and surfaced, an
  absent `cwe` stays `undefined`, well-formed identifiers (`CWE-0`, `CWE-79`,
  `CWE-1004`) pass, malformed ones (empty, `798`, `CWE-`, `cwe-798`, `CWE-79a`,
  `CWE-7 9`) are rejected on the `cwe` field, and a model-supplied
  `compliance_references` key is rejected by the strict schema.

- `feat(review-engine)`: add `generateAuditReference(category)` — generates a
  human-readable audit reference `SOVRI-XX-HHHH-HHHH` (`XX` = fixed two-letter
  category code; each `HHHH` = four uppercase hex chars from `node:crypto`
  random bytes), satisfying the `audit_reference` format. Exported from
  `@sovri/review-engine`; orchestrator wiring lands separately.

- `test(review-engine)`: add acceptance coverage for `generateAuditReference` —
  the canonical `SOVRI-XX-HHHH-HHHH` format, the seven fixed category codes, hex
  segments built from `node:crypto` random bytes, boundary byte values, and
  distinct references across different entropy draws.

- `feat(compliance)`: add `enrichFindingCompliance(finding)` — a pure function
  that recomputes a finding's `compliance_references` from its `cwe` against the
  static CWE map (mapped CWE → its references; unmapped or absent CWE → `[]`),
  never mutating the input and performing no I/O. Re-exported from
  `@sovri/compliance` so the review-engine orchestrator imports it from the
  package root rather than an internal path.

- `feat(core)`: extend the `Finding` schema for the Compliance Trail — add a
  defaulted `compliance_references` array and an optional `audit_reference`
  (`SOVRI-XX-HHHH-HHHH`), plus `ComplianceFrameworkSchema` (CWE, OWASP Top 10,
  ISO 27001, GDPR, DORA, NIS2, AI Act, CRA) and `ComplianceReferenceSchema`
  (applicability `applicable_if` | `informational`, never `confirmed`;
  `condition` required when `applicable_if`), all re-exported from
  `@sovri/core`. Pre-v0.3 findings still parse (backward compatible). Internal
  `@sovri/review-engine` finding constructors set `compliance_references: []`
  to match the extended shape (real-reference enrichment is wired separately).

- `test(core)`: add acceptance coverage for the compliance framework enum,
  reference applicability and condition rules, the audit-reference format,
  `compliance_references` defaulting, backward compatibility, and the new
  public exports.

- `feat(compliance)`: require batch 2 regulatory references — reject mapping
  candidates that miss any required reference: CWE-200 (GDPR Art. 32),
  CWE-284 and CWE-863 (GDPR Art. 32 + DORA Art. 9), CWE-639 (GDPR Art. 32 +
  ISO 27001 A.5.15), CWE-770 (DORA Art. 9 + NIS2 Art. 21(2)(b)), and CWE-918
  (AI Act Art. 12), and enforce the full CWE-798 flagship reference set
  (by framework and identifier) when the static CWE map is built.

- `test(compliance)`: add acceptance coverage for the batch 2 regulatory
  gates (CWE-798 flagship, CWE-200, CWE-770, CWE-639, CWE-863/284, CWE-918).

- `feat(compliance)`: add batch 2 CWE mapping data — 12 new CWE Top 25 2025
  entries (CWE-20, 77, 121, 122, 200, 284, 306, 502, 639, 770, 863, 918) and
  enrich CWE-798 into the flagship hard-coded credentials mapping, bringing
  `getCweMap` to 26 entries.

- `test(compliance)`: add acceptance coverage for batch 2 schema validity,
  map size (26), explicit `applicable_if` conditions, and no `confirmed`
  applicability.

- `test(compliance)`: add acceptance coverage rejecting `CWE-862` mappings
  whose DORA reference is not Art. 9.

- `test(compliance)`: add acceptance coverage for zero-padded CWE
  normalization before the ISO 27001 and DORA required-reference audits.

- `feat(compliance)`: reject web vulnerability CWE mapping candidates missing
  a GDPR Art. 32 reference.

- `test(compliance)`: add acceptance coverage for the missing-GDPR web
  vulnerability data audit.

- `feat(compliance)`: reject compliance mapping references whose `source_url`
  does not use HTTPS.

- `test(compliance)`: add acceptance coverage for the non-HTTPS compliance
  reference source URL audit.

- `feat(compliance)`: reject compliance mapping references whose `source_url`
  host does not match the official host for the referenced framework.

- `test(compliance)`: add acceptance coverage for the non-official
  compliance reference source URL host audit.

- `feat(compliance)`: reject mapping candidates whose `mitre_url` does not
  match the canonical MITRE definition URL for their `cwe_id`.

- `test(compliance)`: add acceptance coverage for the canonical MITRE URL
  mismatch data audit.

- `feat(compliance)`: reject `CWE-862` mapping candidates missing a DORA
  reference.

- `test(compliance)`: add acceptance coverage for the critical ICT missing-DORA
  data audit.

- `feat(compliance)`: reject `CWE-120` mapping candidates missing the ISO
  27001:2022 A.8.28 secure coding reference.

- `test(compliance)`: add acceptance coverage for the `CWE-120`
  missing-ISO-reference data audit.

- `feat(compliance)`: map `CWE-120` to the ISO 27001:2022 A.8.28 secure
  coding control as an informational reference.

- `test(compliance)`: add acceptance coverage for the `CWE-120` ISO
  27001:2022 A.8.28 informational mapping.

- `test(compliance)`: verify every repeated GDPR batch 1 reference uses
  canonical `applicable_if` condition wording.

- `test(compliance)`: verify every repeated DORA and NIS2 batch 1 reference
  uses canonical `applicable_if` condition wording.

- `feat(compliance)`: add canonical DORA Art. 9 and NIS2 conditional
  references for `CWE-78` and `CWE-862` batch 1 mappings.

- `test(compliance)`: add acceptance coverage for canonical GDPR, DORA, and
  NIS2 `applicable_if` condition wording in batch 1 CWE mapping data.

- `feat(compliance)`: add the first 13 static CWE mapping data files and
  import them in the static compliance map loader.

- `test(compliance)`: add acceptance coverage proving batch 1 CWE mapping
  `applicable_if` references carry explicit regulated-context conditions.

### Fixed

- `fix(review-engine)`: reconcile findings across review runs so a re-review
  no longer re-posts a still-valid finding nor re-posts one whose code was fixed
  (#1965). Each inline comment carries a stable, content-derived finding
  fingerprint (`<!-- sovri-finding-id: -->`, independent of line shifts and LLM
  title drift, yet case-sensitive on the targeted code so two same-CWE sinks in
  one file keep separate identities); on re-review the bot reads its own prior
  comments via GitHub GraphQL review threads (each thread's root bot comment,
  non-minimized only; the marker is anchored to the end of the body so a
  marker-like token elsewhere cannot be mis-read) and reconciles the new
  findings against them — skipping already-posted ones,
  collapsing intra-run duplicates, and marking comments whose finding the
  current run no longer produces as outdated (minimized). Embedding the marker
  also activates dismissal of inline findings by id. Reconciliation logic stays
  pure in `@sovri/review-engine` (exposed as `computeFindingFingerprint`,
  `reconcileFindings`, `classifyResolvedComments`, `extractFindingFingerprint`);
  the bot remains a thin GitHub adapter. The reconciliation seam is wired into
  the pull-request handler and degrades fail-open — if the prior-comment fetch
  errors, every finding is posted rather than suppressed, and minimization is
  best-effort.

- `test`: alias `@sovri/compliance` to its source entrypoint in the root Vitest
  config so review-engine source tests do not resolve the package through
  built `dist` output.

- `fix(compliance)`: reject non-canonical Ed25519 audit-trail signature
  encodings in `verifyAuditTrail`, including missing `ed25519:` prefixes,
  padding, ignored junk, or extra base64url suffixes.

- `fix(compliance)`: build the CWE map lazily (memoized in `getCweMap()`) instead
  of at module import. A malformed bundled entry now throws inside a caller's
  guarded path rather than crashing `@sovri/compliance` consumers at load time —
  this is what lets the review-engine orchestrator degrade an affected finding
  to empty `compliance_references` instead of failing the whole review.

- `test`: exclude gitignored git worktrees (`.worktrees/**`) from Vitest test
  discovery, so stale duplicate test files inside local worktrees no longer run
  against the live workspace sources and surface false failures.

### Security

- `fix(config)`: block symlink following (CWE-59) in `loadConfig`
  (`packages/config/src/loader.ts`) — a malicious repo could ship `.sovri.yml`
  as a symlink to any file the bot can read (`/etc/passwd`, `~/.ssh/id_rsa`,
  the GitHub App private key), and on YAML parse failure a fragment of the
  target bytes could leak via `SovriConfigParseError.cause` into PR
  comments. Two-layer defense: pre-open `lstat` check rejects symlinks
  cross-platform, and `O_NOFOLLOW` on the subsequent `open()` provides
  atomic POSIX backup against a TOCTOU swap. New error class
  `SovriConfigSymlinkError` is intentionally minimal (no `cause` field) so
  no file-content fragments can leak via error serialization.
  Follow-up: `readBoundedConfigFile` now also handles two TOCTOU races
  between the `lstat` and `open()`/`fd.stat()` syscalls — disappearance
  (ENOENT/ENOTDIR at open time) falls back to `DEFAULT_CONFIG` per
  contract, and type-flip (regular file becomes a directory) throws
  `SovriConfigParseError` instead of raw `EISDIR` at `readFile()` time.
  Resolves issue #1744 (identified during adversarial review of PR #1743).
- `test(config)`: add explicit FIFO/chardev regression tests for `loadConfig`
  (`packages/config/src/loader.test.ts`) — the underlying `stats.isFile()`
  guards landed with the issue #1744 fix, but the issue #1745 scenario
  (`.sovri.yml` is a FIFO or symlinks to `/dev/zero`, `stats.size` is 0 and
  passes the 64 KiB cap, `fd.readFile()` reads until EOF and OOMs the
  webhook worker) was not pinned by a named regression test. Adds: a real
  POSIX `mkfifo` test for the pre-open `lstat()` path, and two cross-platform
  mocked TOCTOU type-flip tests (FIFO and character device) asserting that
  `readFile()` is never invoked and the file descriptor is closed. The FIFO
  test also mocks `open()` so a guard regression fails fast instead of
  blocking on a readerless named pipe. Resolves issue #1745.
- `fix(config)`: harden `loadConfig` against path-traversal (CWE-22) in
  `packages/config/src/loader.ts` — added early input validation that throws
  `TypeError` when `repoRoot` is not a non-empty string, is not absolute
  per `path.isAbsolute`, or is not normalized
  (`path.normalize(repoRoot) !== repoRoot`). The normalization check rejects
  inputs such as `"/repo/../../etc"`, `"/a/./b"`, and `"/a//b"` that pass
  `path.isAbsolute` but whose `path.join(repoRoot, ".sovri.yml")` resolves
  outside the caller's intended directory. JSDoc updated to document the
  new contract. Resolves issue #1746 (raised during adversarial review of
  PR #1743).
- `fix(config)`: eliminate TOCTOU race condition (CWE-367) in `loadConfig`
  (`packages/config/src/loader.ts`) — replaced separate `stat(path)` +
  `readFile(path)` path-based calls with a single file-descriptor approach
  (`open()` → `fd.stat()` → `fd.readFile()` → `fd.close()`), so the 64 KiB
  size check and the read operate on the same inode; an attacker-controlled
  symlink swap or file replacement between the two syscalls can no longer
  bypass the cap. Flagged by CodeQL `js/file-system-race` (alert #1).

### Changed

- `chore(deps)`: add `zod@4.4.3` (exact-pinned; already resolved in the
  workspace, so the dependency graph and `pnpm dedupe` are unchanged) as a
  direct dependency of `@sovri/community-bot`, used to validate the GitHub
  GraphQL review-threads payload before reconciliation (#1965).
- `chore(deps)`: bump `@anthropic-ai/sdk` 0.96.0 → 0.99.0 (features: cache
  diagnostics beta, thinking-token-count beta, sandbox helpers — no breaking
  change for `messages.create` / `jsonSchemaOutputFormat` / `ContentBlock`
  import paths used by `@sovri/llm-providers`).
- `chore(deps)`: bump `@mistralai/mistralai` 2.2.1 → 2.2.5 (patch releases
  only post-2.2.0; no breaking change for `chat.complete` / `SDKOptions`
  usage in `MistralProvider`).
- `chore(deps-dev)`: bump `oxlint` 1.64.0 → 1.67.0 (minor: adds
  `unicorn/consistent-function-scoping` rule — two test files fixed).
- `chore(deps-dev)`: bump `oxfmt` 0.49.0 → 0.52.0 (minor: formatter
  improvements, no source changes required after format check).
- `chore(deps-dev)`: bump `knip` 6.13.1 → 6.14.2 (minor: Svelte dynamic
  import detection, transitive peer resolution — no action required).
- `chore(deps-dev)`: bump `lefthook` 2.1.6 → 2.1.8 (patch).
- `chore(deps-dev)`: bump `turbo` 2.9.12 → 2.9.15 (patch; stays on v2.x
  per ADR-002).
- `chore(deps-dev)`: bump `vitest` 4.1.6 → 4.1.7, `@vitest/coverage-v8` and
  `@vitest/coverage-istanbul` 4.1.6 → 4.1.7 (patch, across all workspaces).
- `chore(deps/ci)`: bump `docker/setup-qemu-action` v3.7.0 → v4.0.0
  (Node 24 runtime, ESM — no input changes).
- `chore(deps/ci)`: bump `docker/build-push-action` v6.19.2 → v7.1.0
  (Node 24 runtime, ESM — `platforms`, `push`, `tags` inputs unchanged).
- `chore(deps/ci)`: bump `docker/login-action` v3.7.0 → v4.1.0
  (Node 24 runtime, ESM — `registry`/`username`/`password` inputs unchanged).
- `chore(deps/ci)`: bump `actions/setup-node` v4.4.0 → v6.4.0
  (`cache: pnpm` and `node-version-file` inputs confirmed stable in v6).
- `chore(deps/ci)`: bump `actions/download-artifact` v4.3.0 → v8.0.1
  (CJK character support; `name`/`path` inputs unchanged for our SBOM usage).
- `chore(deps/ci)`: add Dependabot `ignore` rules for `@types/node` major
  (tracks Node 24 LTS engine constraint), `pino` major (ADR-006 API
  stability), `turbo` major (ADR-002), and Docker `node` major (ADR-001) to
  prevent recurring ADR-violating PRs.
- `ci(release)`: include `packages/compliance/package.json` in the
  `release-verify-tag` `--package-files` list so the new workspace package
  cannot drift from the release tag.

### Fixed

- `fix(compliance)`: require the canonical DORA Art. 9 identifier for `CWE-862`
  mappings instead of accepting any DORA reference.

- `fix(compliance)`: normalize zero-padded CWE identifiers before enforcing
  the ISO 27001 secure coding and DORA required references.

- `fix(compliance)`: normalize zero-padded CWE identifiers before applying
  the web vulnerability GDPR Art. 32 audit.

- `fix(compliance)`: normalize zero-padded CWE identifiers before comparing
  canonical MITRE definition URLs.

- `fix(test)`: inline arrow functions in `expect(...).toThrow()` calls in
  `parser.mapping.test.ts` and `parser.entries.test.ts` to satisfy the new
  `unicorn/consistent-function-scoping` rule introduced in oxlint 1.67.


### Changed

- `refactor(compliance)`: finalize the `@sovri/compliance` public surface (task-101, #1962). `src/index.ts` now exposes exactly the intended v0.3 surface — 17 named exports (the mapping enricher and schemas with their inferred types, the audit-trail event/entry schemas and types, the `AuditTrailSink` port and `MemoryAuditTrailSink`, and `verifyAuditTrail` with `VerifyResult`). One unit test parses the barrel and asserts the exact export set, that every re-export specifier ends in `.js`, and that the internal signer and file-writer factories never leak into the public API; a second asserts the package `README.md` "Public API" section lists exactly the same identifiers and documents the two factories as internal, so the published docs cannot drift from the code.

### Removed

- `refactor(compliance)`: drop `compliancePackageName` (dead scaffold constant) and `getCweMap` (internal helper, still used by `mapping/enricher.ts`) from the public `@sovri/compliance` exports (task-101, #1962), trimming the v0.3 public surface to the 17 intended exports. No external consumer imported either symbol.

### Fixed

- `fix(bot)`: a missing or empty `.sovri.yml` no longer forces Anthropic — the Community bot resolves the LLM
  provider from deployment configuration (explicit `SOVRI_DEFAULT_LLM_PROVIDER`, or inference from the present
  provider key, Anthropic-first when both are set), so a Mistral-only deployment reviews repositories without a
  `.sovri.yml` instead of posting "env var ANTHROPIC_API_KEY is required" (#1959). A repository `.sovri.yml`
  stays an override and is never shadowed; an unresolvable or malformed deployment configuration posts an
  actionable error naming the variable to set.

## [0.2.0] - 2026-05-26
### Changed

- `release`: prepare the v0.2.0 release metadata and keep the Community image
  pipeline aligned with the v0.1 multi-arch GHCR + SBOM contract. Cosign
  signing remains deferred to v0.5.

- `ci`: add the llm-providers branch coverage gate to backend checks and keep
  the TypeScript coverage artifact for 90 days.

- `docs(ci)`: add verification evidence that the Mistral SDK dependency keeps
  audit, dedupe, coverage, forbidden import/tool, and CycloneDX SBOM checks
  green.

### Security

- `fix(bot)`: restrict dismiss finding marker matching to bot-authored review
  comments so collaborator-planted `sovri-finding-id` markers cannot poison the
  dismissed state set.

### Fixed

- `fix(ci)`: cap `release-extract-notes` output via opt-in `--max-bytes` and
  `--repo-url` flags so the `release.yml` `gh-release` job no longer trips the
  GitHub Releases 125 000-character body limit when the promoted changelog
  section is large; truncated bodies now end with a notice that links back to
  the full `CHANGELOG.md` entry at the release tag (closes #1160).

- `test(llm-providers)`: advance retry fake timers without an awaited loop so
  the full oxlint gate passes cleanly.

- `fix(bot)`: paginate the dismiss reaction lookup with `per_page=100` so a
  bot `-1` reaction past the first reaction page is still recognised as a
  dismissed finding.
- `fix(bot)`: fetch dismiss reactions sequentially to avoid bursting GitHub
  concurrent-request limits on PRs with many findings.
- `fix(bot)`: when multiple marked walkthroughs exist, the dismiss command now
  updates the newest matching walkthrough review (and fallback issue comment)
  instead of the oldest one returned first by `listReviews`.

### Added

- `feat(compliance)`: add the compliance mapping entry schema, static CWE map
  loader API implementation with defensive map reads and frozen mapping
  entries, initial `CWE-798` static mapping data, and acceptance coverage for
  applicability, conditional references, missing CWE lookups, and public type
  exports.

- `test(compliance)`: add acceptance coverage for the new `@sovri/compliance`
  workspace package scaffold manifest fields.

- `feat(compliance)`: scaffold the `@sovri/compliance` workspace package with
  ESM package metadata, build/test/typecheck scripts, tsup, Vitest coverage
  thresholds, and placeholder source directories.

- `docs(config)`: add the public [`.sovri.yml` reference](docs/sovri-yml-reference.md)
  covering active providers, review modes, ignores, limits, and safe API key
  environment variable usage.

- `fix(bot)`: log dismiss GitHub update failures with delivery id and status
  while posting a generic retry comment without raw response bodies.

- `test(bot)`: add dismiss logging coverage proving secret-like webhook fields
  and installation tokens stay out of logs.

- `feat(bot)`: log successful dismiss command handling with GitHub delivery
  correlation fields and without raw issue comment payloads.

- `test(bot)`: add issue-comment acceptance coverage for extra dismiss tokens
  becoming unknown commands before review comment search.

- `test(bot)`: add dispatcher acceptance coverage for malformed dismiss finding
  ids becoming unknown commands.

- `test(bot)`: add dispatcher acceptance coverage for valid boundary dismiss
  finding ids reaching the dismiss handler.

- `test(bot)`: add end-to-end dismiss update coverage proving the marked
  walkthrough cost footer is preserved.

- `fix(bot)`: insert `No findings.` when dismiss re-rendering removes every
  visible finding while preserving the existing cost footer.

- `test(bot)`: add dismiss coverage for removing the final visible finding.

- `test(bot)`: add dismiss coverage proving walkthrough re-rendering keeps the
  existing cost footer as the final non-empty line.

- `fix(bot)`: treat duplicate GitHub dismiss reaction responses as accepted
  dismissed state during concurrent retries.

- `test(bot)`: add dismiss coverage for concurrent duplicate reaction responses.

- `test(bot)`: add dismiss coverage proving already-dismissed findings are not
  reported as errors or unknown ids.

- `fix(bot)`: treat repeated dismiss commands as accepted when the bot already
  reacted with `-1` on the matching review comment.

- `test(bot)`: add dismiss coverage proving repeated commands do not create
  duplicate finding reactions.

- `feat(bot)`: update fallback issue-comment walkthroughs in place when
  dismissing findings and no marked pull request review body exists.

- `test(bot)`: add dismiss coverage requiring fallback walkthrough comments to
  stay on their original issue-comment surface.

- `test(bot)`: add dismiss coverage proving human `-1` reactions do not hide
  findings from the walkthrough.

- `feat(bot)`: update the marked walkthrough after dismissing a finding so
  entries with bot-authored `-1` reactions are hidden.

- `test(bot)`: add dismiss coverage requiring walkthrough updates to exclude
  every finding dismissed by the bot while keeping visible finding markers.

- `test(bot)`: add dismiss coverage proving inline finding markers are parsed
  when surrounded by normal review Markdown.

- `feat(bot)`: restrict `@sovri-bot dismiss` to the pull request author before
  mutating dismissed finding state.

- `test(bot)`: add dismiss coverage proving non-author commenters cannot
  dismiss a finding even when its inline marker exists.

- `test(bot)`: strengthen visible-only dismiss coverage to require no PR label
  and no accepted command reaction when the hidden marker is absent.

- `feat(bot)`: add the dismiss success state mutations: PR label
  `sovri:dismissed-finding` and `+1` reaction on the accepted command comment.

- `test(bot)`: extend dismiss success coverage to require the PR label and
  accepted command reaction for matched inline markers.

- `test(bot)`: add dismiss coverage proving visible finding text without the
  hidden marker is still treated as an unknown finding id.

- `feat(bot)`: react to a matched `@sovri-bot dismiss` inline finding comment
  with a `-1` review-comment reaction instead of reporting the finding as unknown.

- `test(bot)`: extend existing dismiss finding coverage to require the `-1`
  review-comment reaction for matched inline markers.

- `fix(bot)`: paginate `@sovri-bot dismiss` review-comment marker lookup
  before reporting a finding id as unknown.

- `test(bot)`: add regression coverage for a matching dismiss finding marker
  beyond the first review-comment page.

- `fix(bot)`: gate unknown `@sovri-bot dismiss` errors on actual inline
  finding markers so known findings are not rejected as missing.

- `test(bot)`: add regression coverage proving known dismiss finding markers
  do not trigger the unknown-finding error path.

- `feat(bot)`: report an unknown `@sovri-bot dismiss` finding id with one
  issue comment and no GitHub review-state mutation.

- `test(bot)`: add ATDD RED coverage requiring `@sovri-bot dismiss` to post
  one unknown-finding error comment without mutating GitHub review state.

- `feat(bot)`: route `@sovri-bot re-review` issue comments through the
  shared pull request synchronize review flow after resolving and validating
  the current pull request from GitHub.

- `test(bot)`: add ATDD acceptance coverage for `@sovri-bot re-review`
  reaching the shared pull request review flow, requiring the issue-comment
  command path to load repository config, fetch the pull request diff, call the
  review engine, and post a walkthrough against the current PR head.

- `test(bot)`: add ATDD acceptance coverage proving `@sovri-bot re-review`
  preserves the shared synchronize review collaborator order: config loading,
  diff fetching, review execution, and review posting.

- `test(bot)`: add ATDD acceptance coverage proving the issue-comment
  dispatcher routes `@sovri-bot re-review` without fetching pull request diffs
  or posting review results itself.

- `test(bot)`: add ATDD acceptance coverage proving `@sovri-bot re-review`
  resolves the current pull request through `pulls.get` and posts the
  walkthrough against that returned head commit.

- `test(bot)`: add ATDD acceptance coverage proving `@sovri-bot re-review`
  ignores a stale synchronize webhook head SHA and reviews the current head
  returned by `pulls.get`.

- `test(bot)`: add ATDD acceptance coverage proving a failed re-review
  `pulls.get` lookup posts one failure comment and stops before diff fetching,
  review execution, or walkthrough posting.

- `feat(bot)`: acknowledge accepted `@sovri-bot re-review` commands with a
  single `+1` reaction after the current pull request lookup succeeds and
  before the shared review flow posts the walkthrough.

- `test(bot)`: add ATDD acceptance coverage proving accepted `@sovri-bot
  re-review` commands create exactly one `+1` reaction and do not emit a
  second acknowledgement after the walkthrough is posted.

- `test(bot)`: add ATDD violation coverage proving `@sovri-bot re-review`
  does not create the accepted `+1` reaction when the current pull request
  lookup fails before command acceptance.

- `test(bot)`: add ATDD violation coverage for `@sovri-bot re-review`
  shared-flow failures, requiring one explanatory issue comment and no
  successful walkthrough review when diff fetching, review execution, or
  review posting fails.

- `test(bot)`: add ATDD coverage proving `@sovri-bot re-review` logs both
  the original review failure and failure-comment posting failure while
  attempting exactly one failure comment.

- `test(bot)`: add ATDD nominal coverage proving successful `@sovri-bot
  re-review` posts a walkthrough review and does not post an error issue
  comment.

- `test(bot)`: add ATDD violation coverage proving `@sovri-bot re-review`
  skips draft pull requests when `review.autoReviewDrafts` is disabled,
  logging the skip without fetching diffs, running the review engine, or
  posting a walkthrough.

- `test(bot)`: add ATDD nominal coverage proving `@sovri-bot re-review`
  reviews draft pull requests when `review.autoReviewDrafts` is enabled,
  preserving the shared review flow and posting the walkthrough against the
  current head commit.

- `test(bot)`: add ATDD nominal coverage proving `@sovri-bot re-review`
  still reviews non-draft pull requests when `review.autoReviewDrafts` is
  disabled, posting the walkthrough against the current head commit.

- `feat(bot)`: configure the shared pull request review flow with the v0.1
  300000 ms LLM timeout budget, so `@sovri-bot re-review` and webhook reviews
  use the same provider deadline.

- `test(bot)`: add ATDD violation coverage proving `@sovri-bot re-review`
  does not install a separate 60000 ms or 900000 ms timeout budget.

- `feat(bot)`: register the `issue_comment.created` Probot webhook through
  `registerWebhookHandlers`, wire a real Octokit `reactions.createForIssueComment`
  reactor for unknown commands, and route re-review and dismiss commands through
  pending-handler log stubs until the dedicated command handlers land. The
  dispatcher factory reads the bot login from `SOVRI_BOT_LOGIN` and falls back
  to `sovri-bot[bot]`, keeping the dispatcher reachable in production with
  delivery correlation propagated end-to-end.

- `test(bot)`: add the first issue-comment dispatcher ATDD acceptance
  scenario for Probot-validated `@sovri-bot re-review` comments, requiring
  the dispatcher to call the re-review handler with the GitHub delivery
  correlation ID and without forwarding raw signature headers, backed by the
  minimal issue-comment handler contract for that path and a non-PR issue
  guard before command parsing. The dispatcher acceptance suite now also covers
  bot self-comments being skipped before command parsing or command side
  effects, with the handler comparing the comment author against the configured
  bot login before parsing, and plain issue comments being ignored before
  command parsing or command side effects. Re-review dispatcher coverage now
  also pins delivery correlation and GitHub comment ID propagation, and dismiss
  dispatcher coverage starts pinning the same delivery, comment, and finding ID
  propagation contract with the handler routing parsed dismiss commands to a
  dedicated dismiss dependency. Re-review routing coverage now also verifies the
  dispatcher does not fetch pull request diffs or post review results itself,
  and dismiss routing coverage pins the same boundary. No-mention dispatcher
  coverage now starts pinning silent skips for ordinary PR issue comments, with
  the handler returning before command side effects. Unknown command coverage
  now starts pinning a single confused reaction without command or review
  side effects, with the handler routing unknown commands to the reaction
  dependency.

- `feat(bot)`: start the `@sovri-bot` command parser contract with
  acceptance coverage and a pure parser implementation for
  case-insensitive line-start `re-review` mentions, plus lowercase
  `re-review` and first-valid-mention precedence coverage with implementation
  for lowercase `dismiss <finding-id>`, including fallback to the first
  unknown command when no later valid command exists, valid alphanumeric dash
  finding ids through the 64-character boundary, malformed finding ids returning
  `unknown` with raw remainders, `dismiss` without an id returning `unknown`,
  with exact command-verb coverage, `unknown` results for unsupported command
  words, non-exact command
  verbs, mentions without commands returning an empty raw remainder,
  punctuation-preserving unknown raw remainders, trailing-whitespace trimming for
  unknown raw remainders, and supported commands with extra tokens, repeated
  whitespace after the bot mention before
  supported commands, ordinary comments without a bot mention, inline prose
  mentions ignored as `no-mention`, empty comment bodies returning `no-mention`,
  while indented and quoted mentions remain ignored, and repeated parsing
  of the same input remains deterministic without GitHub event context,
  environment reads, or Node filesystem imports.

- `feat(review-engine)`: start wiring walkthrough cost-footer behavior by
  allowing the composer to accept reviews without token usage while still
  rendering complete Markdown without broken footer placeholders and
  preserving the exported walkthrough input type as Review-shaped. Reviews now
  carry an explicit provider usage signal so synthetic zero-token defaults do
  not render billing text, while usage-backed Anthropic and Mistral walkthroughs
  append the cost footer after all existing walkthrough sections. Acceptance
  coverage now defines and renders the horizontal-rule separator before
  usage-backed footers.

- `feat(review-engine)`: add a pure walkthrough cost helper with static
  Anthropic and Mistral provider pricing, four-decimal USD estimates,
  non-breaking unavailable-cost fallback for unknown provider/model
  pricing, and public walkthrough exports for `PROVIDER_PRICING`,
  `estimateCostUsd`, and `renderCostFooter`.

- `feat(review-engine)`: wire `reviewPullRequest` to apply configured path
  ignore filters to the parsed `Diff` before prompt construction, skip
  provider calls cleanly when every changed file is ignored, and log
  changed, reviewable, and ignored file counts without raw patch content.

- `feat(review-engine)`: start the pre-LLM `filterDiffByIgnores`
  helper contract so empty ignore patterns preserve every diff file and
  patch, including generated-file patches, while returning a fresh
  `Diff` object without mutating the input, exported from the
  review-engine diff module and package index. Empty diff inputs also
  remain empty when ignore patterns are present, and acceptance coverage
  now defines deterministic repeated-call filtering for non-empty ignore
  patterns; the implementation applies POSIX glob filtering to both
  `Diff.files` and the returned unified diff patches without reading
  environment overrides, including when imported after an override is set,
  while preserving surviving file objects by value and honoring directory
  descendant globs such as `dist/**` plus Node POSIX brace, extglob, and lockfile
  glob examples, applying multiple ignore patterns with OR semantics, removing
  every file and patch for catch-all `**`, matching renamed files by their
  current path, staying within the 50 ms local soft budget for a 500-file diff
  using median post-warmup samples, dropping ignored patches from large unified
  diffs, preserving every file and patch when no large-diff pattern matches, with
  prevalidated configuration patterns applied without returning validation
  metadata, invalid-looking unmatched patterns kept as a no-op without surfacing
  config validation errors, readonly pattern tuples accepted without mutation, and
  leading `!` treated literally rather than as gitignore negation, plus static
  coverage for the `node:path` POSIX matcher import and call while rejecting
  third-party glob imports including side-effect import forms.

### Fixed

- `fix(bot)`: route failed review-engine results through the shared pull
  request error-comment path, so provider timeout failures post one issue
  comment instead of a failed walkthrough review.

- `fix(bot)`: make PR review fallback issue comments explicitly explain that
  the walkthrough could not be posted as a pull request review while keeping
  the walkthrough marker for future updates and cleanup.

- `fix(bot)`: keep `@sovri-bot re-review` running when the accepted-command
  `+1` reaction cannot be created, logging the reaction failure without
  blocking the review flow.

- `test(bot)`: tighten the re-review lookup-failure acceptance check so the
  scenario asserts the actual diff-fetch collaborator is not called after
  `pulls.get` fails.

- `fix(bot)`: report `@sovri-bot re-review` pull request lookup and response
  validation failures through the shared pull request review error-comment path
  instead of letting command preflight failures escape silently.

- `fix(review-engine)`: walkthrough cost lookup now rejects prototype-key
  model names (`__proto__`, `constructor`, `toString`,
  `hasOwnProperty`) via an `Object.hasOwn` own-property check before
  returning pricing, so unknown models keep the documented `unavailable`
  fallback instead of feeding inherited prototype values into
  `estimateCostUsd` and rendering `$NaN`.

- `fix(config)`: `review.mode: strict` in `.sovri.yml` now fails config
  validation with `Mode 'strict' is reserved for v0.5+ and is not yet
  enabled` instead of silently flowing through as an enabled review mode,
  while the exported `ReviewModeSchema` enum remains wide for the future
  v0.5 strict-mode rollout.

- `fix(bot)`: missing provider API keys now surface as a single
  configuration error comment on the pull request instead of the generic
  review-failed message, and the handler logs typed missing-key metadata
  with the GitHub delivery correlation ID without exposing secret values.
  Community-bot E2E coverage now also verifies that a repository config
  selecting Mistral sends the review request to the Mistral adapter rather
  than falling back to Anthropic.

- `fix(llm-providers)`: `MistralProvider` review hardening (PR #1267
  feedback from CodeRabbit and Codex). `createJsonSchemaDefinition` in
  `packages/llm-providers/src/providers/MistralProvider.response.ts`
  now rejects schemas whose JSON Schema root is not `type: "object"`
  (e.g. `z.string()`), failing fast at request construction instead of
  shipping an invalid `json_schema` payload to the Mistral API.
  `resolveModel` in `packages/llm-providers/src/providers/MistralProvider.ts`
  now returns the trimmed value so whitespace-padded models like
  `" mistral-large-latest "` no longer reach the SDK with surrounding
  whitespace. `waitForResponseOrAbort` in
  `packages/llm-providers/src/providers/MistralProvider.test-helpers.ts`
  now checks `signal.aborted` synchronously and clears its timer on
  abort, matching the existing `waitForAbort` helper so tests that
  exercise pre-aborted signals stop racing the response timer.

- `test(supply-chain)`: `scripts/mistral-sdk-policy.test.sh`
  `has_install_lifecycle_script` now uses `Object.prototype.hasOwnProperty`
  for `preinstall` / `install` / `postinstall` key presence instead of
  truthiness, so a package declaring `"preinstall": ""` is still flagged
  as carrying a lifecycle script. `run_license_verification_uses_ci_gate`
  now exercises the no-`--input` branch of `scripts/check-licenses.mjs`
  by mocking `pnpm licenses list --json` via a `PATH`-prepended shim
  fed from `MISTRAL_LICENSE_FIXTURE`, so the test actually covers the
  `spawnSync` path that CI hits (PR #1238 review feedback from CodeRabbit
  on `scripts/mistral-sdk-policy.test.sh:82-88` and `:368-381`).

- `fix(llm-providers)`: `retryWithBackoff` now routes synchronous
  throws from `fn` through the retry pipeline. The `fn` invocation
  moved inside the `runAttempt` `try` block so a non-async caller that
  throws before returning a `Promise` flows through `isRetryable`
  dispatch, the attempt cap, the budget-vs-sleep guard, durations
  capture, and the typed-error wrapping. The `deadlineTimer` is now
  declared as a `let` in the outer scope so the `finally` block can
  conditionally call `clearTimeout` only when the timer was actually
  scheduled. The tie-breaking ordering at the exact deadline boundary
  is preserved — `fn`'s internal `setTimeout` still registers before
  the helper's deadline `setTimeout` (PR #1217 review feedback from
  codex and CodeRabbit on `retry.ts:77/83`).

### Changed

- `feat(llm-providers)`: `AnthropicProvider.retry.ts` now consumes the
  generic `retryWithBackoff` helper. The provider keeps its own
  Anthropic-specific `isRetryable` predicate (mirroring the v0.1 SDK
  policy — retry on `APIConnectionError` + HTTP 408/409/429/5xx,
  reject `APIConnectionTimeoutError` so it surfaces immediately as a
  timeout) and maps the helper's typed terminal errors back into the
  provider error hierarchy (`RetryExhaustedError → AnthropicRetryError`
  with `cause`-derived `status` / `requestId`,
  `RetryTimeoutError → AnthropicTimeoutError`, non-retryable rethrows
  → `AnthropicAuthError` / `AnthropicResponseError` via the existing
  `normalizeAnthropicError` mapper). The provider tracks per-attempt
  durations through a closure-scoped array so non-retryable error
  paths preserve the v0.1 `attemptDurationsMs` contract. The retry
  loop, backoff calculation, jitter, deadline scheduling, and abort
  controller lifecycle are now owned by the helper. Zero regression on
  the existing 122 `AnthropicProvider.*.test.ts` cases (R-05 + R-03
  satisfied).

### Added

- `feat(review-engine)`: prompt construction now accepts the task-scoped
  review modes `full`, `bugs-only`, and `minimal`. Full mode preserves the
  v0.1 system prompt exactly, bugs-only mode focuses the model on
  correctness issues while explicitly ignoring style-only and
  performance-only guidance, and minimal mode limits output to at most
  three blocker or major findings. `reviewPullRequest` now forwards
  `config.review.mode` into prompt construction, with golden prompt
  coverage for the three supported modes. The orchestrator config schema
  also accepts the v0.1 `strict` mode value and maps it to `full` so
  existing `.sovri.yml` files do not regress (PR #1346 review feedback
  from Codex on `packages/review-engine/src/orchestrator.ts:50`).

- `feat(llm-providers)`: add the shared provider factory entrypoint
  (`createProviderFromConfig`) for creating Anthropic and Mistral providers
  from Sovri LLM configuration, with acceptance coverage for the supported
  provider creation path. Both factory paths forward configured custom base
  URLs to their respective provider adapters, and unsupported providers or
  missing API keys fail with typed errors. Unsupported provider values are
  rejected before credential lookup so diagnostics point to provider support
  rather than missing secrets. The community bot now delegates provider
  bootstrap to the package factory instead of carrying Anthropic-specific
  construction logic.

- `test(llm-providers)`: add factory coverage for `baseUrl` forwarding to
  both Anthropic and Mistral provider constructors via `vi.mock` spies, and
  assert the configured `model` is propagated to the created provider.

- `test(llm-providers)`: expand `MistralProvider` coverage with
  MSW-backed happy-path, token-usage, transient retry, exhausted 503,
  non-retryable 401, schema-invalid response, and deterministic
  timeout/jitter assertions. The Mistral tests now use only the dummy
  `test-key` API key and keep timing-sensitive cases on fake timers so
  `pnpm exec vitest run packages/llm-providers` remains network-free
  and deterministic. The fake-timer timeout case in
  `packages/llm-providers/src/providers/MistralProvider.errors.test.ts`
  no longer guards a real wall-clock budget (`vi.getRealSystemTime()`
  delta `< 100 ms`); the typed `MistralProviderTimeoutError` assertion
  alone proves the abort path without coupling the suite to CI runner
  scheduling jitter (PR #1285 review feedback from Codex).

- `feat(llm-providers)`: add `MistralProvider` backed by Mistral La
  Plateforme structured chat completions. The adapter exposes the shared
  `LLMProvider` contract, defaults to `mistral-large-latest`, supports
  configurable `model`, `baseUrl`, `timeoutMs`, `maxAttempts`, and
  `maxTokens`, sends Zod-derived JSON Schema response formats, validates
  parsed responses with Zod, returns `{ prompt, completion }` token usage,
  and maps retry exhaustion, timeout, and non-retryable provider failures to
  typed Mistral errors without leaking API keys. The provider is covered by
  focused request-shape, retry, timeout, option-validation, and export tests.

- `deps(llm-providers)`: add `@mistralai/mistralai@2.2.1` as an
  exactly pinned runtime dependency for the upcoming Mistral provider.
  The SDK package reports `Apache-2.0`, its newly added transitive
  license buckets stay inside the repository allowlist, and the
  dependency graph is validated with the existing high/critical audit
  gate.

- `test(llm-providers)`: triangulation regression guard asserting that
  the AttemptContext `AbortSignal` exposed to `fn` becomes aborted at
  the per-attempt budget boundary. With `timeoutMs: 200` and a fn that
  awaits the signal, the captured signal must show `aborted === true`
  after `advanceTimersByTimeAsync(200)`, and the helper must throw
  `RetryTimeoutError` once. Pins the abort-via-AttemptContext path
  separately from #1189's RetryTimeoutError-shape assertions (R-03
  technical limit, ATDD scenario sub-issue #1199 under US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `retryWithBackoff` shrinks the per-attempt budget across recursion.
  With `timeoutMs: 5000`, an attempt-1 rejection after 800 ms, and a
  500 ms backoff sleep (0 % jitter), the AttemptContext captured on
  attempt 2 must show `timeoutMs === 3700` (exact: `5000 - 800 - 500`).
  Any future change that froze the budget at the configured value (no
  recompute on recurse) would break (R-01 nominal, ATDD scenario
  sub-issue #1198 under US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `retryWithBackoff` forwards the full configured `opts.timeoutMs` to
  `AttemptContext.timeoutMs` on the first attempt. The test uses
  `timeoutMs: 5000` and a captures-on-every-attempt `fn` that resolves
  `"ok"` immediately, then asserts the captured context shows
  `timeoutMs === 5000`, `attempt === 1`, and a fresh non-aborted
  `AbortSignal`. Complements #1184 (which used 60000 ms) and guards
  the drift-free budget propagation through the public entry (R-01
  nominal, ATDD scenario sub-issue #1197 under US #1183).

- `test(llm-providers)`: triangulation regression guard pinning the
  second retry delay at the endpoints of the ±20 % jitter band around
  the 1000 ms exponential step. Two outline rows drive
  `Math.random.mockReturnValueOnce(firstRandom).mockReturnValueOnce(secondRandom)`
  to produce `(−20 %, +20 %) → (400 ms, 1200 ms)` and
  `(+20 %, −20 %) → (600 ms, 800 ms)` across attempts 1→2 and 2→3.
  Validates the jitter formula across both consecutive draws (R-03
  violation, ATDD scenario sub-issue #1196 under US #1183).

- `test(llm-providers)`: triangulation regression guard pinning the
  first retry delay at the exact endpoints of the ±20 % jitter band.
  Drives `Math.random` to `0 / 0.5 / 1` (yielding jitter factors of
  `-20 % / 0 % / +20 %` on the helper's `(random*2-1)*0.2` formula)
  and asserts the helper waits exactly `400 ms / 500 ms / 600 ms`
  between attempt 1 and attempt 2 before resolving `"ok"` (R-03
  violation, ATDD scenario sub-issue #1195 under US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `retryWithBackoff` respects the `opts.maxAttempts` cap for every
  documented value (1, 2, 3, 5). The `vitest` `it.each` outline drives
  `fn` to reject `"E_TRANSIENT"` on every call against the parametric
  cap, advances fake time through `2^(attempt-1)` ms backoffs, then
  asserts the typed error fires after exactly `maxAttempts` invocations
  with a matching-length durations array. Current impl satisfies every
  example with no production-code diff; the test pins the breadth so a
  future change that hardcoded a specific cap (e.g. always 3) would
  break visibly (R-02 violation, ATDD scenario sub-issue #1194 under
  US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `RetryExhaustedError.attemptDurationsMs` preserves each per-attempt
  duration in order across exhausted retries. The test schedules
  attempt 1 to reject after 40 ms, attempt 2 after 55 ms, attempt 3
  after 70 ms (with deterministic 0 % jitter for the 500 ms and
  1000 ms backoffs) and asserts the typed error carries
  `[40, 55, 70]`. The cap-hit path landed under #1192 already
  accumulates durations correctly; this test pins the value-by-value
  contract so any future change to the duration capture would break
  visibly (R-06 violation, ATDD scenario sub-issue #1193 under US
  #1183).

- `feat(llm-providers)`: `retryWithBackoff` now caps retries at
  `opts.maxAttempts`. When the catch block has classified the failure
  as retryable but the current attempt index is already at the cap,
  the helper throws `RetryExhaustedError("Operation failed after <N>
  attempts", { cause, attemptDurationsMs })` carrying the last
  attempt's cause and the accumulated per-attempt durations. The
  matching acceptance test schedules three E_TRANSIENT failures
  against a 3-attempt cap (with deterministic 0 % jitter so the 500 ms
  + 1000 ms backoffs are exact) and asserts the typed error fires with
  the correct message, three durations, the third Error instance as
  cause, and `fn` invoked exactly three times (R-06 violation +
  R-02 maxAttempts, ATDD scenario sub-issue #1192 under US #1183).

- `feat(llm-providers)`: `retryWithBackoff` now treats a response that
  arrives at exactly `timeoutMs` as success, matching the v0.1 boundary
  contract pinned by `AnthropicProvider.retry.test.ts`. The `runAttempt`
  body calls `fn` BEFORE scheduling the deadline `setTimeout`, so the
  operation's internal timer (registered synchronously inside its
  Promise executor) wins any tie at the exact boundary. A parametric
  vitest outline verifies 999 ms / 1000 ms / 1001 ms responses against
  a 1000 ms timeout: the first two resolve `"ok"`, the third throws
  `RetryTimeoutError` (R-02 timeoutMs + R-03 deadline limit, ATDD
  scenario sub-issue #1191 under US #1183).

- `feat(llm-providers)`: `retryWithBackoff` now surfaces the timeout
  before scheduling a retry that cannot fit. When the catch block has
  classified the failure as retryable, the helper compares the next
  nominal backoff (`nextRetryDelayMs(opts.baseDelayMs, attempt)`)
  against the remaining budget (`deadlineMs - Date.now()`). If the
  budget cannot accommodate the sleep, the helper throws
  `RetryTimeoutError("Operation timed out after <N> ms", { cause,
  attemptDurationsMs })` carrying the rejected attempt's cause and the
  accumulated durations. The retry sleep and recursive call are
  reached only when the budget can still fit the sleep. The matching
  acceptance test uses fake timers to schedule an attempt-1 rejection
  600 ms into an 800 ms timeout (with 500 ms base delay and 0 % jitter)
  and asserts the typed error fires with `attemptDurationsMs === [600]`
  and `cause === eTransient` (R-03 deadline + R-06 violation, ATDD
  scenario sub-issue #1190 under US #1183).

- `feat(llm-providers)`: `retryWithBackoff` now enforces an aggregate
  `timeoutMs` deadline. The helper schedules a per-attempt
  `setTimeout(() => controller.abort(), budgetMs)` and tracks
  `attemptDurationsMs` across recursion. When the controller's signal
  fires (deadline elapsed during `fn`) or when the next attempt's
  remaining budget is `<= 0` (deadline already past), the helper
  throws `RetryTimeoutError("Operation timed out after <N> ms", { cause,
  attemptDurationsMs })`. The function entry pins `budgetMs =
  opts.timeoutMs` for attempt 1 so AttemptContext.timeoutMs is exactly
  the configured value (no `Date.now()` drift); attempts 2+ get
  `deadlineMs - Date.now()` against the original deadline. The matching
  acceptance test uses `vi.useFakeTimers()` to advance fake time
  exactly 200 ms after invoking the helper with a 200 ms timeout and
  asserts the signal aborts, the typed error fires, and exactly one
  attempt was executed (R-06 violation + R-03 deadline, ATDD scenario
  sub-issue #1189 under US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `retryWithBackoff` rethrows any caller-classified non-retryable HTTP
  token (`HTTP_400`, `HTTP_401`, `HTTP_403`, `HTTP_404`, `HTTP_422`)
  verbatim without wrapping. A `vitest` `it.each` outline mirrors the
  Scenario Outline `Examples:` table. The `isRetryable`-dispatch branch
  landed under #1187 already satisfies every example with no
  production-code diff; the test pins the breadth so any future
  regression that special-cased one of the documented non-retryable
  statuses would break (R-06 violation, ATDD scenario sub-issue #1188
  under US #1183).

- `feat(llm-providers)`: `retryWithBackoff` now consults
  `opts.isRetryable(cause)` before scheduling a retry. When the
  predicate returns `false`, the helper rethrows the original error
  reference verbatim without wrapping it in `RetryExhaustedError` or
  `RetryTimeoutError`. Adds the typed `RetryExhaustedError` and
  `RetryTimeoutError` classes to the helper module (each exposing
  `readonly attemptDurationsMs: readonly number[]` and
  `cause: unknown`) and re-exports the full helper API
  (`retryWithBackoff`, `AttemptContext`, `RetryOptions`,
  `RetryErrorOptions`, both error classes) from the
  `@sovri/llm-providers` package barrel (R-04). The matching
  acceptance test asserts object identity is preserved across the
  rethrow, `fn` is called exactly once, and the rethrown error is not
  an instance of either typed helper error (R-06 violation, ATDD
  scenario sub-issue #1187 under US #1183).

- `test(llm-providers)`: triangulation regression guard asserting that
  `retryWithBackoff` retries any caller-classified retryable token
  (`HTTP_408`, `HTTP_409`, `HTTP_429`, `HTTP_500`, `HTTP_502`, `HTTP_503`,
  `HTTP_504`, `HTTP_529`, `TRANSPORT`) once and resolves on the next
  attempt. A `vitest` `it.each` outline mirrors the Scenario Outline
  `Examples:` table. The current `runAttempt` recursion already satisfies
  every example with no production-code diff; the test pins the breadth
  so a future regression that special-cased any token would break (R-02
  nominal, ATDD scenario sub-issue #1186 under US #1183).

- `feat(llm-providers)`: `retryWithBackoff` now retries on failure.
  Refactored to a recursive `runAttempt` helper that catches `fn`'s
  rejection, computes the next backoff via
  `baseDelayMs * 2^(attempt-1) * (1 ± 0.2 * random())`, sleeps, then
  re-invokes `fn` with `attempt + 1` and a fresh `AbortController`. The
  module-scoped `RETRY_JITTER_RATIO = 0.2` constant pins the ±20 %
  jitter band. No `isRetryable` dispatch yet (deferred to #1187), no
  `maxAttempts` cap (#1192), no aggregate-timeout deadline (#1189). The
  matching acceptance test asserts that one retryable failure followed
  by a successful attempt resolves with `"ok"` after exactly 500 ms of
  backoff and 2 total invocations of `fn` (R-02 nominal, ATDD scenario
  sub-issue #1185 under US #1183).

- `feat(llm-providers)`: scaffold the new `retryWithBackoff(fn, opts)`
  helper at `packages/llm-providers/src/helpers/retry.ts`. The helper
  module exports the `AttemptContext` and `RetryOptions` interfaces plus
  the function itself. The initial implementation honours the
  happy-first-attempt scenario: it constructs a fresh `AbortController`,
  calls `fn` once with an `AttemptContext` carrying `attempt === 1`,
  `timeoutMs === opts.timeoutMs`, and the non-aborted `signal`, and
  returns the resulting promise — no retry loop, no deadline scheduler,
  no error wrapping yet (subsequent scenarios add each of those
  behaviours under their own failing tests). A co-located vitest unit
  test pins the contract (R-01 nominal, ATDD scenario sub-issue #1184
  under US #1183).

- `test(config)`: regression-guard asserting that `loadConfig()`
  surfaces the v0.2 provider refine failure through
  `SovriConfigValidationError` with `name === "SovriConfigValidationError"`,
  the resolved `filePath`, and structured `issues[]` carrying
  `path === ["llm", "provider"]` plus the documented v0.2 message. New
  fixture `test-fixtures/schema-violation-openai-compatible/.sovri.yml`
  exercises the `openai-compatible` rejection path through the loader
  (R-04 technical, ATDD scenario sub-issue #1171 under US #1162).

- `test(config)`: regression-guard asserting that
  `SovriConfigSchema.safeParse({llm: {provider: "openai", ...}}).error.issues`
  exposes a `llm.provider` issue with structured `path === ["llm",
  "provider"]` (array, not joined string) and the documented v0.2
  message. Pins the contract PR-comment renderers rely on to surface
  field-level errors without re-parsing (R-04 technical, ATDD scenario
  sub-issue #1170 under US #1162).

- `test(config)`: strengthen the existing `gemini` rejection test inside
  the v0.2 widening describe block to assert (a) exactly one issue at
  path `llm.provider` and (b) `issue.code === "invalid_value"` — the Zod
  enum-step failure code, distinct from the refine custom code. Guards
  against a regression that would route out-of-enum values through the
  refine path instead of the enum gate (R-03 limit, ATDD scenario
  sub-issue #1169 under US #1162).

- `test(config)`: tag the existing `Provider` type-inference test with
  the `R-03 nominal —` marker so it is traceable to the ATDD scenario
  asserting that the inferred `Provider = z.infer<typeof ProviderSchema>`
  union stays `"anthropic" | "mistral" | "openai" | "openai-compatible"`
  across v0.2. Assertion body and `expectTypeOf` call are unchanged
  (R-03 nominal, ATDD scenario sub-issue #1168 under US #1162).

- `test(config)`: regression-guard asserting that `ProviderSchema.options`
  keeps exactly the four declared members
  `["anthropic", "mistral", "openai", "openai-compatible"]`. Pins the
  ADR-005 wide-enum / narrow-refine pattern at the runtime layer so any
  accidental drop or addition trips a test rather than a downstream
  switch/case. The assertion lives inside the `describe("ProviderSchema")`
  block alongside the other enum-shape assertions, per the file's "one
  describe = one subject" convention (R-03 nominal, ATDD scenario
  sub-issue #1167 under US #1162).

- `test(config)`: regression-guard asserting that the
  `SovriConfigSchema.safeParse()` rejection message for `llm.provider`
  is byte-identical between `openai` and `openai-compatible`. Guards
  against template drift if a future change introduces a per-value
  interpolation in the refine message (R-02 technical, ATDD scenario
  sub-issue #1166 under US #1162).

- `test(config)`: regression-guard `it.each` over the v0.2-rejected
  providers (`openai`, `openai-compatible`) asserting that
  `SovriConfigSchema.safeParse()` returns `success=false` with exactly
  one issue at path `llm.provider` whose message equals the documented
  v0.2 string `Only 'anthropic' and 'mistral' are enabled in this
  release.` (R-02 violation, ATDD scenario sub-issue #1165 under US #1162).

- `test(config)`: failing test asserting `provider=mistral` is accepted
  by `SovriConfigSchema.safeParse()` with `success=true` and parsed
  `llm.provider` equal to `"mistral"`. Red until the v0.2 widen flips
  the refine to the `{anthropic, mistral}` allow-list (R-01 nominal,
  ATDD scenario sub-issue #1164 under US #1162).

- `test(config)`: regression-guard test asserting `provider=anthropic`
  still passes the v0.2 refine widening via `SovriConfigSchema.safeParse()`
  (R-01 nominal, ATDD scenario sub-issue #1163 under US #1162).

- `feat(scripts)`: `findMarkdownHeadingLine` now splits on both LF
  and CRLF line endings, so a CRLF-encoded README closes its fenced
  block on the closing-fence line instead of trapping a stray `\r`
  in the closer trailer (per coderabbitai Major review on PR #1159).

- `feat(scripts)`: the shared release-heading suffix regex now
  **requires** the `- YYYY-MM-DD` date on the same line as the
  `## [X.Y.Z]` heading. `hasChangelogReleaseSection` and
  `getChangelogReleaseSection` both delegate to
  `findChangelogReleaseHeadingMatch`, so `release-verify-tag` and
  `release-extract-notes` reject every bare-heading or
  newline-separated shape uniformly (per chatgpt-codex-connector P1
  + coderabbitai Major reviews on PR #1159).

- `feat(scripts)`: `findMarkdownHeadingLine` now tracks the opening
  fence delimiter (backtick or tilde) **and its length**, and only
  closes the fenced block when a matching delimiter of the same
  family with at least the same length and no trailing info string
  appears. A `~~~` line inside a backtick-fenced block, a triple
  ` ``` ` inside a four-backtick block, and a ` ```javascript `
  candidate closer all leave the block open, so a fake `## Install`
  inside the same code block cannot fool
  `readme-references-release` (per chatgpt-codex-connector and
  coderabbitai reviews on PR #1159).

- `chore(ci)`: `.github/workflows/release.yml` `Extract release notes`
  step now shells out to
  `node scripts/ci-policy.mjs release-extract-notes` instead of
  carrying an inline `indexOf("## [<version>]")` extractor. The
  dedicated subcommand uses the strict
  `## [<version>](optional - YYYY-MM-DD)` regex shared with
  `release-verify-tag`, so promoted dated headings no longer leak the
  ` - YYYY-MM-DD` suffix as the first line of `release-notes.md` (per
  codex P2 review on PR #1159).

- `feat(scripts)`: `promote-changelog` now refuses to write a release
  section when `## [Unreleased]` has no bullet entries; the gate fires
  before any file mutation and surfaces
  `Refusing to release with empty Unreleased` (plus
  `Add at least one bullet under [Unreleased] before promoting`) so an
  empty promotion cannot slip past the post-promote `release-verify-tag`
  branches (per codex P1 review on PR #1159).

- `feat(scripts)`: add `release-verify-commit-subject` subcommand to
  `scripts/ci-policy.mjs` that runs `git -C <repo> log -1 --pretty=%s`
  and rejects HEAD subjects that do not equal
  `chore(release): v<X.Y.Z>`, with the targeted remediation hint
  `Commit subject must equal chore(release): v<X.Y.Z>` (#1134).

- `feat(scripts)`: add `release-verify-tag-annotation` subcommand to
  `scripts/ci-policy.mjs` that runs `git -C <repo> cat-file -t <tag>`
  and rejects lightweight tags with
  `verify_tag_annotation=fail` on stdout plus the actionable
  remediation hint `Recreate the tag with git tag -a <tag> -m
  "Release v<version>"` on stderr (#1133).

- `feat(scripts)`: `readme-references-release` now emits the targeted
  `Repository path must be <image>` remediation hint when the README
  contains a `docker pull <other-repo>:v<version>` snippet whose
  repository path does not match the expected image (#1131).

- `feat(scripts)`: add `readme-references-release` subcommand to
  `scripts/ci-policy.mjs` that checks the root `README.md` contains
  the literal `docker pull <image>:v<version>` snippet and an
  `## Install` section within the first 200 lines; root README now
  includes the canonical `docker pull
  ghcr.io/mpiton/sovri/community-bot:v0.1.0` snippet under
  `## Install` (#1129).

- `feat(scripts)`: `release-verify-tag` now produces an actionable
  `Refusing to release with empty Unreleased` failure (with the
  `Add at least one bullet under [Unreleased] before tagging`
  remediation hint) when the engineer tags a release whose
  `## [Unreleased]` body is empty and no `## [X.Y.Z]` section exists
  yet (#1119).

- `feat(scripts)`: add `release-extract-notes` subcommand to
  `scripts/ci-policy.mjs` that prints the body of `## [X.Y.Z]` (with
  optional `- YYYY-MM-DD` suffix) and fails with
  `Missing changelog section ## [X.Y.Z]` for any malformed heading
  (DD-MM-YYYY, slash separator, missing brackets, prefixed `v`)
  (#1117).

- `feat(scripts)`: `release-verify-tag` now rejects a CHANGELOG where the
  release section exists but `[Unreleased]` still contains bullet
  entries; the inconsistent state surfaces as
  `[Unreleased] still has entries after release section` instead of
  silently passing (#1116).

- `feat(scripts)`: add `promote-changelog` subcommand to
  `scripts/ci-policy.mjs` that rewrites `CHANGELOG.md` for a release by
  moving every `[Unreleased]` entry under a new `[X.Y.Z] - YYYY-MM-DD`
  heading while preserving the empty `[Unreleased]` section (#1115).

- `test(e2e)`: add unrecorded image provenance failure coverage and
  validator messaging for the v0.1 smoke run (#1016).

- `test(e2e)`: add complete nominal soak-log row coverage for every
  qualifying PR and an explicit content assertion pass message (#1019).

- `test(e2e)`: add nominal committed soak-log evidence coverage with PR
  rows for v0.1 task evidence validation (#1050).

- `test(e2e)`: add redacted secret placeholder coverage for captured log
  secret validation (#1035).

- `test(e2e)`: add no-crash coverage and validator support for contextual
  process exit evidence during the smoke PR set, including latest in-range
  evidence precedence (#1030).

- `test(e2e)`: add synchronize-event smoke PR count coverage and validator
  support for deduplicating repeated events by PR (#1042).

- `test(e2e)`: add missing webhook receipt timestamp coverage for v0.1
  latency evidence validation (#1047).

- `test(e2e)`: add three-PR below-minimum smoke-count coverage for v0.1
  smoke PR validation (#1039).

- `test(e2e)`: add wrong GHCR image repository rejection coverage for
  v0.1 image provenance validation (#1017).

- `test(e2e)`: add nominal GitHub credential wiring evidence coverage for
  signed webhook acceptance and installation token availability (#1054).

- `test(e2e)`: add manual quality rating scale and minimum threshold
  coverage for v0.1 soak-log validation (#1023).

- `test(e2e)`: add wrong GitHub webhook secret rejection evidence coverage
  for the v0.1 smoke run (#1057).

- `test(e2e)`: add latency-sample PR qualification coverage using GitHub
  additions plus deletions for the changed-line boundary (#1046).

- `test(e2e)`: add missing Docker restart-count evidence coverage for the
  no-crash smoke assertion (#1032).

- `test(e2e)`: add missing GitHub App webhook subscription coverage for
  pull_request and issue_comment installation evidence (#1014).

- `test(e2e)`: add missing GitHub App permission coverage for
  pull_requests, contents, issues, and metadata installation evidence (#1013).

- `test(e2e)`: aggregate target repository evidence rows across multiple
  complete soak-log tables (#1022).

- `test(e2e)`: ensure soak-log validation selects the complete evidence
  table for the target repository when other repository tables appear first
  (#1022).

- `test(e2e)`: restrict soak-log field, duplicate, latency, finding-count,
  and row-count checks to the complete PR evidence table (#1022).

- `test(e2e)`: add missing required soak-log field coverage for PR URL,
  latency, finding count, manual quality rating, and unrelated leading
  Markdown tables (#1022).

- `test(e2e)`: add missing target repository GitHub App installation failure
  coverage for the v0.1 smoke run (#1011).

- `test(e2e)`: add missing qualifying PR evidence row coverage and row-only
  soak validator support for the v0.1 smoke log (#1020).

- `test(e2e)`: add missing GitHub runtime credential startup failure
  evidence coverage and validator support for the v0.1 smoke run (#1055).

- `test(e2e)`: add missing first Sovri PR comment latency failure coverage
  for the v0.1 smoke run (#1048).

- `test(e2e)`: add missing captured Docker logs failure coverage for the v0.1
  smoke run (#1036).

- `test(e2e)`: add unset Anthropic API key evidence coverage for the v0.1
  smoke run (#1006).

- `test(e2e)`: add malformed APP_ID startup failure coverage, runtime
  validation, and soak evidence validator support with missing-value,
  whitespace, and oversized-number guards (#1056).

- `test(e2e)`: add committed soak-log evidence coverage and validator support
  for rejecting untracked local soak logs (#1051).

- `test(e2e)`: add local-build image provenance coverage for missing source
  commit evidence and validator failure reason support (#1018).

- `test(e2e)`: add soak-log latency duration validation coverage and validator
  support for invalid latency values (#1025).

- `test(e2e)`: add invalid private key startup failure evidence coverage and
  validator support for fixture and non-fixture credential values (#1059).

- `test(e2e)`: add individual smoke PR qualification matrix coverage and
  validator output for included and excluded reasons (#1041).

- `test(e2e)`: add no-crash failure coverage for `/health` returning 503 during
  the smoke PR set (#1029).

- `test(e2e)`: add nominal GitHub App installation evidence coverage and
  validator checks for required permissions, webhook subscriptions, signed PR
  webhook delivery, and required GitHub API access (#1010).

- `test(e2e)`: add four-PR minimum smoke-count coverage for the
  `minimum count reached` classification (#1038).

- `test(e2e)`: add four-PR p95 latency acceptance coverage for the strict
  below-90-second smoke target (#1044).

- `test(e2e)`: add four-PR no-crash acceptance coverage with explicit
  no-exit event evidence (#1027).

- `test(e2e)`: add five-PR target smoke-count coverage and validator output
  for qualifying count plus target/minimum classification (#1037).

- `test(e2e)`: add five-PR p95 latency acceptance coverage for the strict
  below-90-second smoke target (#1043).

- `test(e2e)`: add five-PR no-crash smoke evidence coverage and validator
  support for per-review health checks plus no-exit events (#1026).

- `test(e2e)`: add first-comment latency measurement coverage and validator
  support (#1049).

- `test(e2e)`: add non-negative soak-log finding count coverage and validator
  support (#1024).

- `test(e2e)`: add strict p95 latency boundary coverage and validator support
  for the 90-second limit (#1045).

- `test(e2e)`: add escaped private key newline startup evidence coverage and
  validator support (#1058).

- `test(e2e)`: add empty committed soak-log evidence coverage and
  validator support (#1053).

- `test(e2e)`: add empty Anthropic API key smoke evidence coverage and
  validator support (#1009).

- `test(e2e)`: add duplicate soak evidence row rejection coverage and
  validator support for qualifying PRs (#1021).

- `test(e2e)`: add smoke PR count exclusion and strict malformed
  minimum-count coverage plus validator support for draft, 500-line, and
  wrong-branch PRs (#1040).

- `test(e2e)`: add GitHub App identity and repository-binding rejection
  coverage plus validator support for the smoke installation assertion (#1012).

- `test(e2e)`: add crash evidence matrix, missing evidence, and latest-line
  outcome coverage for no-crash smoke validation (#1031).

- `test(e2e)`: add no-crash restart plus missing, truncated, and malformed
  restart evidence failure coverage for the smoke PR set (#1028).

- `test(e2e)`: add clean captured log metadata success coverage and malformed
  repeated secret argument rejection (#1033).

- `test(e2e)`: add captured log raw-secret and missing-log failure coverage
  (#1034).

- `test(e2e)`: add Anthropic provider log secret-redaction smoke coverage
  (#1008).

- `test(e2e)`: add parameterized successful Anthropic smoke review evidence
  coverage (#1005).

- `test(e2e)`: add Anthropic authentication failure smoke evidence coverage
  (#1007).

- `test(e2e)`: add v0.1 soak image provenance acceptance coverage (#1015).

### Fixed

- `scripts(validate-v0-1-soak)`: detect any non-empty `git status --short`
  output for the soak log (modified, staged, deleted, renamed) instead of only
  the untracked `??` prefix, so the `soak-log-commit` rule correctly rejects
  uncommitted edits (#1114 review feedback).

- `test(e2e)`: accept GitHub App API access evidence for any PR number instead
  of hard-coding PR 101 (#1010 review feedback).

- `test(e2e)`: reject impossible negative PR latency evidence when comment
  timestamps precede webhook receipt timestamps (#1049 review feedback).

- `test(e2e)`: ignore stale pre-webhook PR comments when measuring first-comment
  latency (#1049 review feedback).

- `test(e2e)`: require committed soak-log metadata and PR evidence rows to
  match the expected repository exactly (#1053).

- `test(msw)`: shared Anthropic handler now returns `anthropic-empty.json` for
  non-`json_schema` requests so the structured-output branch is exercised
  distinctly from the default response (#966 review feedback).

### Security

- `test`: add shared MSW handlers and anonymized GitHub/Anthropic fixtures for
  network-free package and bot tests (#58).

- `test`: scope per-package `vitest run` discovery to the package directory by
  passing `--root .` in workspace `test` scripts, so `pnpm --filter X test`
  exercises only that package's suite rather than the entire monorepo (#937).

- `test`: add ATDD coverage and policy evaluation for rejecting missing or
  inaccurate Vitest API style documentation (#932).

- `test`: add ATDD coverage and policy evaluation for rejecting enabled Vitest
  globals (#931).

- `test`: add ATDD coverage and policy evaluation for missing, partial,
  chained, and locally aliased Vitest explicit-import violations (#930).

- `test`: add the root Vitest config with disabled globals, repo-root project
  resolution, workspace source aliases, and v8 coverage summary output (#57).

- `test`: add ATDD coverage for the root Vitest explicit-import policy (#929).

- `ci`: add Dependency Review policy coverage and a pinned pull-request-only
  workflow for license and advisory blocking (#56).

- `ci`: add CodeQL policy coverage and a pinned GitHub Advanced Security
  workflow for JavaScript/TypeScript analysis (#55).

- `ci`: add release workflow policy coverage and the v0.1.0 GHCR, SBOM, and
  GitHub Release publishing workflow (#54).

- `ci`: add changelog-check documentation classification coverage for Markdown
  files inside package folders (#813).

- `ci`: add R-01 changelog-check assertion coverage rejecting failure results for
  documentation-only pull requests (#812).

- `ci`: add changelog-check trigger policy coverage requiring the gate to be
  eligible on `pull_request` events (#791).

- `ci`: add changelog-check trigger policy coverage rejecting workflows without
  the required `changelog-check` job (#792).

- `ci`: add changelog-check trigger policy coverage rejecting jobs eligible for
  `push`, `workflow_dispatch`, or `schedule` (#793).

- `ci`: add changelog-check trigger policy coverage allowing other workflow
  triggers when the gate remains pull-request-only (#794).

- `ci`: add changelog-check trigger policy coverage rejecting
  `pull_request_target` as a substitute for `pull_request` (#795).

- `ci`: add changelog-check diff gate coverage allowing CI-only pull requests
  without a `CHANGELOG.md` entry (#796).

- `ci`: add R-02 changelog-check assertion coverage rejecting failure results for
  CI-only pull requests (#797).

- `ci`: add changelog-check diff classification coverage for workflow files as
  non-code for changelog enforcement (#798).

- `ci`: add changelog-check remediation message coverage naming `CHANGELOG.md`,
  `.ts/.tsx`, and the required changelog entry action (#799).

- `ci`: add changelog remediation-message validation coverage rejecting vague
  failure text (#800).

- `ci`: add changelog-check remediation coverage proving passing TypeScript PRs
  with `CHANGELOG.md` do not emit remediation failures (#801).

- `ci`: add changelog-check remediation coverage including an example changed
  TypeScript path in failure messages (#802).

- `ci`: add changelog-check diff coverage allowing TypeScript changes when the
  root `CHANGELOG.md` is updated (#803).

- `ci`: add changelog-check diff coverage rejecting `.ts` and `.tsx` changes
  without a root `CHANGELOG.md` update (#804).

- `ci`: add changelog-check diff file-set classification coverage for mixed
  documentation and TypeScript changes requiring `CHANGELOG.md` (#805).

- `ci`: add changelog-check base-to-head diff coverage for passing combinations
  where TypeScript and root changelog failure conditions are not both present
  (#806).

- `ci`: add changelog-check base-to-head diff coverage rejecting TypeScript
  changes without a root `CHANGELOG.md` update (#807).

- `ci`: add changelog-check base-to-head diff coverage for TypeScript renames
  without a root `CHANGELOG.md` update (#808).

- `ci`: add changelog-check base-to-head diff coverage for TypeScript deletions
  without a root `CHANGELOG.md` update (#809).

- `ci`: add changelog-check base-to-head diff scope coverage so earlier
  TypeScript changes are not hidden by the final commit file set (#810).

- `ci`: add changelog-check documentation-only diff coverage allowing README,
  docs, and ADR changes without `CHANGELOG.md` (#811).

- `ci`: add Docker setup action pinning policy coverage requiring the
  `build-docker` QEMU and Buildx setup actions to use full commit SHAs (#739).

- `ci`: add Docker setup action pinning fixture coverage rejecting moving QEMU
  and Buildx setup action references (#740).

- `ci`: add Docker setup action pinning fixture coverage rejecting missing QEMU
  or Buildx setup actions in `build-docker` (#741).
- `ci`: add Docker setup action pinning fixture coverage for Buildx SHA
  length boundaries in `build-docker` (#742).
- `ci`: add Docker setup action pinning fixture coverage rejecting invalid
  forty-character QEMU SHA character classes in `build-docker` (#743).
- `ci`: add Trivy image vulnerability gate coverage for built images with
  no high or critical vulnerabilities (#744).
- `ci`: add Trivy image vulnerability gate coverage rejecting high
  vulnerabilities in built images (#745).
- `ci`: add Trivy image vulnerability gate coverage rejecting critical
  vulnerabilities in built images (#746).
- `ci`: add Trivy image vulnerability gate coverage rejecting missing scan
  results for built images (#747).
- `ci`: add Trivy scan configuration policy coverage requiring HIGH/CRITICAL
  severities, equivalent severity ordering, and exit-code 1 in `build-docker`
  (#748).
- `ci`: add Trivy scan configuration fixture coverage rejecting missing
  blocking severity sets in `build-docker` (#749).
- `ci`: add Trivy scan configuration fixture coverage rejecting a missing
  Trivy action in `build-docker` (#750).
- `ci`: add Trivy scan configuration boundary coverage for exit-code values
  that control whether blocking vulnerabilities fail CI (#751).
- `ci`: add Trivy step completion policy coverage proving exit-code 1 turns
  blocking vulnerabilities into a failed `build-docker` job (#752).
- `ci`: add Trivy SARIF upload policy coverage requiring CodeQL to publish
  `trivy-results.sarif` to GitHub Security after the Trivy step from
  `build-docker` (#753).
- `ci`: add Trivy SARIF producer/uploader boundary coverage for format,
  output path, upload path, and upload condition agreement (#754).
- `ci`: add Trivy SARIF upload fixture coverage rejecting a missing CodeQL
  upload action in `build-docker` (#755).
- `ci`: add Trivy SARIF upload fixture coverage rejecting mismatched
  `sarif_file` upload paths in `build-docker` (#756).
- `ci`: add Trivy SARIF upload-after-failure policy coverage proving CodeQL
  still publishes `trivy-results.sarif` after a blocking Trivy finding (#757).

- `ci`: add Docker build action policy coverage requiring `docker/build-push-action`,
  `push: false`, exactly `linux/amd64` and `linux/arm64`, and GitHub Actions
  cache configuration for `build-docker` (#734).

- `ci`: add Docker build action fixture coverage rejecting `push: true` in the
  `build-docker` verification job (#735).

- `ci`: add Docker build action fixture coverage rejecting a `build-docker` job
  that omits `docker/build-push-action` (#736).

- `ci`: add Docker build action platform boundary fixture coverage for the exact
  `linux/amd64` and `linux/arm64` contract (#737).

- `ci`: add Docker build action fixture coverage rejecting missing GitHub Actions
  cache inputs in `build-docker` (#738).

- `ci`: pass `persist-credentials: false` to every `actions/checkout` step in
  the forbidden-tools and forbidden-imports workflows so `GITHUB_TOKEN` is no
  longer written to local git config and cannot leak into later steps or
  uploaded artifacts (#724, zizmor `artipacked`).

### Fixed

- `test`: enforce per-fixture JSON parse success in
  `packages/review-engine/src/shared-msw-contract.test.ts` "finds all required
  fixture files" so malformed fixtures fail the contract instead of slipping
  through a tautological length assertion (#965).

- `ci`: align the `build-docker-needs` job-header regex in
  `scripts/ci-policy.mjs` with the rest of the policy so a workflow
  declaring `build-docker: &anchor` is no longer reported as missing
  required `needs` (#790).

- `ci`: broaden the TypeScript escape-hatch detector in
  `scripts/no-forbidden-tools.sh` so `Array<any>`, `Promise<any>`, union
  types like `string|any`, and `value:any` (no space) are all caught while
  identifiers that merely contain the substring `any` (`manyThings`,
  `anyhow`, `company`) remain allowed (#724).

- `ci`: add a defense-in-depth pass to `scripts/no-forbidden-tools.sh` that
  strips comments and folds newlines before re-running the ADR-001 and
  ADR-003 patterns. Closes bypass forms such as multiline `value:\nany`,
  `value:/*x*/any`, `require ("node:fs")`, `require/*x*/(...)` and
  `module . exports = ...` that the per-line scan alone could not see
  (#724).

- `ci`: report a configuration error when the secrets-scan workflow references
  the shared no-secrets guard but the script file is missing or outside the
  repository root, including symlink targets (#685).

- `ci`: reject secrets-scan no-secrets script invocations that would mask a
  failing shared guard result (#684).

- `ci`: add fixture coverage rejecting inline duplicated API-key pattern scans
  when secrets-scan does not run the shared no-secrets guard (#683).

- `ci`: add fixture coverage ensuring the secrets-scan duration budget ignores
  faster sibling jobs such as backend-checks (#681).

- `ci`: add fixture coverage proving secrets-scan duration measurement excludes
  GitHub Actions queue time (#680).

- `ci`: add fixture coverage rejecting secrets-scan durations at or above one
  minute in the duration budget policy (#679).

- `ci`: add fixture coverage rejecting Gitleaks action pins whose provenance
  is not the v2 release line (#677).

- `ci`: add fixture coverage rejecting forty-character Gitleaks action pins
  that contain non-lowercase-hex characters (#676).

- `ci`: add fixture coverage for 39/40/41-character SHA boundary handling in
  the secrets-scan Gitleaks action policy (#675).

- `ci`: add fixture coverage rejecting the moving `gitleaks/gitleaks-action@v2`
  tag in the secrets-scan Gitleaks action policy (#674).

- `ci`: add fixture coverage ensuring the secrets-scan Gitleaks action is
  rejected when it is missing from the workflow (#673).

- `ci`: add fixture evidence coverage ensuring resolved false-positive fixtures
  do not suppress unresolved real leak fixtures in the secrets-scan gate (#671).

- `ci`: add fixture evidence policy coverage for resolved false-positive
  secret fixtures in the secrets-scan gate (#669).

- `ci`: mention the full-history checkout requirement when positive
  `fetch-depth` values are rejected by the secrets-scan policy (#667).

- `ci`: report named critical severity vulnerabilities from the supply-chain
  audit gate failure output (#657).

- `ci`: report named high severity vulnerabilities from the supply-chain audit
  gate failure output (#656).

- `ci`: `scripts/ci-policy.mjs` now writes machine-readable output via
  `fs.writeSync` instead of the buffered `process.stdout`/`stderr` streams so
  the immediate `process.exit()` on failure paths cannot truncate the payload
  the acceptance tests and downstream CI consumers rely on (#654).
- `ci`: drop the unused `--workflow-queue-ms` argument from the
  `run_duration_queue_exclusion_case` test and clarify in the Gherkin comment
  that queue time is excluded by anchoring measurement at the runner-start
  instant (`--job-start-ms`) rather than via a dedicated CLI flag (#654).

- `apps/community-bot`: keep comment-poster marker pagination sequential while
  satisfying the strict `no-await-in-loop` oxlint gate.

- `apps/community-bot` tests: derive exact `/version` endpoint expectations
  from the community bot package manifest instead of repeating the current
  package version literal in assertions (#570).

- `apps/community-bot`: comment poster now posts fresh inline review drafts via
  `pulls.createReviewComment` when updating an existing marked walkthrough
  review (previously only the body was updated, dropping new findings on
  synchronize reruns), paginates `pulls.listReviews` and `issues.listComments`
  to find markers beyond the first page, optionally filters lookups by
  `actorLogin` to avoid matching foreign artifacts that contain the marker,
  and re-checks for an existing marked fallback comment before creating a new
  one to close the TOCTOU window on concurrent reruns (#43).
- `apps/community-bot`: existing-review branch in the comment poster now
  refreshes the walkthrough body via `pulls.updateReview` first and posts
  inline drafts via `Promise.allSettled` so a single rejected
  `pulls.createReviewComment` no longer blocks the marker refresh, and the
  whole branch runs inside the same `try` as `pulls.createReview` so any
  failure routes through `postFallbackComment` instead of bubbling out of
  `postReview` (#43).
- `apps/community-bot`: rejected inline review comment posts are now logged
  with their HTTP status and draft index instead of being silently swallowed
  by `Promise.allSettled`, and a successful `pulls.updateReview` or
  `pulls.createReview` deletes any pre-existing marked fallback comment so a
  stale walkthrough does not linger on the PR after a later run succeeds
  (#43).
- `apps/community-bot`: `cleanupStaleFallback` now treats the
  `issues.listComments` lookup as best-effort. A transient or permission
  failure during the stale-fallback lookup is logged and swallowed instead
  of bubbling into the main `postReview` try, so a successful
  `pulls.createReview` or `pulls.updateReview` is no longer misreported as a
  failure and never triggers a duplicate fallback comment (#43).
- `apps/community-bot`: Docker `builder` and `prod-deps` stages now `COPY .npmrc`
  before `pnpm install` so the supply-chain controls (`ignore-scripts=true`,
  `engine-strict=true`, `save-exact=true`) apply during image builds instead of
  silently dropping when the stage starts from a clean WORKDIR (#617).
- `apps/community-bot`: Docker `HEALTHCHECK` now probes `http://127.0.0.1:${PORT}/health`
  so the `PORT` env override stays in sync with the runtime listener instead of
  always hitting port 3000 (#617).
- `apps/community-bot` tests: `inspectRuntimeUser` contract predicate now accepts
  `sovri`, `sovri:1001`, and `1001:1001` to match the `final image must run as
  sovri:1001` failure message it advertises (#617).
- `apps/community-bot` tests: `waitFor` helper now rejects synchronously when
  the abort signal is already aborted (including the `ms === 0` fast path) and
  removes its abort listener on natural timeout to avoid dangling references.
- `apps/community-bot`: the `pulls.listFiles` fallback now rejects as soon as
  it reaches GitHub's 3000-file listing cap, since the endpoint cannot signal
  truncation past the cap and would otherwise return a silently truncated diff.
- `apps/community-bot`: `scripts/smoke-docker.sh` now bounds each `/health`
  probe with `--connect-timeout 1 --max-time 2` so a single hung curl request
  cannot bypass the 30s `HEALTH_TIMEOUT_MS` contract, re-checks the elapsed
  deadline after a 200 response so a probe that starts just under the deadline
  and returns after it is reported as a timeout failure instead of a smoke
  pass, and the operational smoke-docker test suite asserts the
  script-emitted elapsed-wait line and build-failure phase string instead of
  tautological local-variable matches (#633).

### Security

- `apps/community-bot`: validate `PRIVATE_KEY` by parsing through
  `node:crypto.createPrivateKey` instead of substring marker matching, and
  reject non-decimal `PORT` env values (e.g. `1e3`, `0x10`) to enforce a
  strict base-10 integer contract.

### Added

- `ci`: add `forbidden-tools` and `forbidden-imports` workflow jobs with
  full-tree policy guards for toolchain restrictions and the Community/Cloud
  import boundary (#51, #709-#723).

- `ci`: add a secrets-scan reuse policy ensuring the workflow calls the shared
  `scripts/no-secrets.sh` guard instead of duplicating secret patterns inline
  (#682).

- `ci`: add a secrets-scan duration budget policy that accepts runs strictly
  below one minute (#678).

- `ci`: add a Gitleaks action pinning policy for the `secrets-scan` job that
  accepts full commit SHA pins with v2 release-line provenance (#672).

- `ci`: add secrets-scan checkout depth policy coverage for full-history
  `actions/checkout` configuration (#664).

- `ci`: add a supply-chain audit shell gate that propagates
  `pnpm audit --audit-level=high` failures before reporting success (#658).

- `ci`: add the first supply-chain audit gate command for accepting pnpm audit
  reports that contain no high or critical vulnerabilities (#655).

- `ci`: add the first CI policy helper for backend-checks cache-hit duration
  budget evaluation, measured job-duration reporting, and cache-miss
  classification, strict 5-minute failure handling, plus workflow action SHA
  pinning validation (#634-#643).

- `apps/community-bot`: add `scripts/smoke-docker.sh` and operational coverage
  for local Docker build/run smoke testing, `/health` polling, boot-log
  assertions, supported macOS/Linux behavior, failure exit codes, and smoke
  container cleanup (#47, #618-#632).

- `apps/community-bot`: add an app-scoped multi-stage Docker image contract
  covering root `.dockerignore` exclusions, non-root runtime identity, runtime
  artifact layout, image-size budget boundaries, and `/health` healthcheck
  metadata (#601-#616).

- `apps/community-bot`: add Probot/MSW end-to-end ATDD coverage for opened
  and synchronize pull request review flows, deterministic GitHub fixtures,
  Anthropic structured responses, review posting, permission fallback,
  no-network enforcement, secret redaction assertions, and suite budget
  checks (#572-#598).

- `apps/community-bot`: add unauthenticated `GET /version` backed by the
  community bot package manifest with Node major-version normalization (#554,
  #556, #560-#562).

- `apps/community-bot`: add ATDD coverage for Docker healthcheck command
  shape, `/version`, in-process operational endpoint tests, and stateless
  health/version behavior (#552-#568).

- `apps/community-bot`: add the first operational route registrar with
  unauthenticated `GET /health` plus the root Dockerfile healthcheck targeting
  the default Community bot port (#551).

- `apps/community-bot`: add ATDD coverage for the operational `/health`
  endpoint and Docker healthcheck contract (#551).

- `apps/community-bot`: add a GitHub comment poster adapter for marked
  idempotent walkthrough reviews, inline review drafts, audit identifier
  logging, issue-comment fallback, and MSW-backed posting outcomes (#43,
  #529-#549).

- `apps/community-bot`: add an Octokit pull request diff fetcher using the
  raw GitHub diff endpoint with paginated `pulls.listFiles` fallback, 30 s
  timeout handling, typed failures, and adapter coverage for #42.

- `apps/community-bot`: add ATDD coverage for pull request handler
  delegation across opened and synchronize webhook examples (#477).

- `apps/community-bot`: add cwd-independent ATDD coverage for pull request
  handler safety, draft, synchronization, and error-reporting scenarios
  (#478-#501).

- `apps/community-bot`: add draft skipping, correlated safe logging, and
  single error-comment reporting to pull request handlers (#478-#501).

- `apps/community-bot`: wire opened and synchronize webhooks to the pull
  request review handler flow at runtime (#41).

- `apps/community-bot`: load repository `.sovri.yml` content for runtime pull
  request reviews and post structured findings as inline PR review comments
  (#41).

- `@sovri/config`: expose validated `.sovri.yml` content parsing for GitHub
  webhook adapters (#41).

- `apps/community-bot`: add pull request handler orchestration for opened
  and synchronize webhooks using injected config, diff, review, and posting
  collaborators without adding handler-local review logic (#477).

- `apps/community-bot`: add the Probot bootstrap entry point contract with a
  named `app` registration factory, runtime environment validation, and
  structured startup logging through `@sovri/observability`, with local dev
  startup routed through the server entry point (#40).

- `apps/community-bot`: add the initial Probot scaffold with manifest,
  package metadata, source layout, TypeScript inheritance, and scaffold
  contract tests (#39).

- `@sovri/review-engine`: add the initial `reviewPullRequest`
  orchestration entrypoint with severity threshold and ignored path filters
  while enforcing configured review limits and preserving provider finding
  metadata with safe POSIX and Windows path normalization (#373).

- `@sovri/review-engine`: add scenario coverage for review orchestrator
  severity threshold and ignored path filters (#373).

- `@sovri/review-engine`: add scenario test coverage that findings below the
  configured severity threshold are dropped (#374).

- `@sovri/review-engine`: add scenario test coverage that ignored paths are
  dropped after parsing while non-ignored findings are kept (#375).

- `@sovri/review-engine`: add scenario test coverage that file count review
  limits are inclusive before provider calls (#376).

- `@sovri/review-engine`: add scenario test coverage that changed-line review
  limits are inclusive before provider calls (#377).

- `@sovri/review-engine`: add scenario test coverage for pre-provider limit
  skips returning schema-valid failed reviews with zero token usage (#378).

- `@sovri/review-engine`: copy provider token usage into Review results,
  including Anthropic cached input-token fields, when providers expose
  structured generation metadata (#379).

- `@sovri/review-engine`: add scenario test coverage that invalid provider
  token usage is rejected before returning a Review (#380).

- `@sovri/review-engine`: accumulate token usage across schema-validation
  corrective retries, mark corrected reviews as partial, and avoid retrying
  provider protocol errors that expose validation issues while validating each
  attempt's token usage before accumulation (#381).

- `@sovri/review-engine`: add MSW-backed integration coverage for the
  `reviewPullRequest` happy path producing a successful Review and anchorable
  inline comment draft (#382).

- `@sovri/review-engine`: add MSW-backed integration coverage for the
  `reviewPullRequest` corrective retry path returning a partial Review with
  accumulated token usage (#383).

- `@sovri/review-engine`: return a schema-valid failed Review with a synthetic
  `review_failed` finding when provider response parsing still fails after the
  corrective retry, including deleted-file fallback locations with zero new-line
  anchors and long retryable provider error messages (#384).

- `@sovri/review-engine`: add use-case coverage that a normal
  `reviewPullRequest` call only crosses I/O boundaries through the injected
  provider, including an import-time environment-read guard (#385).

- `@sovri/review-engine`: reject missing `reviewPullRequest` providers through
  explicit input validation before review execution or fallback I/O can occur
  (#386).

- `@sovri/review-engine`: return a failed `Review` when the injected provider
  rejects during `reviewPullRequest`, without attempting fallback filesystem or
  network I/O (#387).

- `@sovri/review-engine`: add scenario coverage that a valid provider response
  produces every required `Review` field in `reviewPullRequest` (#388).

- `@sovri/review-engine`: validate `reviewPullRequest` pull request, diff, and
  config inputs before provider execution so invalid inputs cannot produce
  partial reviews (#389).

- `@sovri/review-engine`: add scenario coverage that zero-finding provider
  responses still produce complete successful reviews (#390).

- `@sovri/review-engine`: add scenario coverage that successful
  `reviewPullRequest` results validate against `ReviewSchema` and
  `FindingSchema` (#391).

- `@sovri/review-engine`: add scenario coverage through `reviewPullRequest`
  that assembled reviews missing `tokens_used` are rejected by `ReviewSchema`
  before return (#392).

- `@sovri/review-engine`: add scenario coverage that parse-fallback failed
  reviews still validate against `ReviewSchema` after repeated schema-invalid
  provider responses (#393).

- `@sovri/review-engine`: add scenario coverage that first-response
  `reviewPullRequest` success sets status `success` without corrective retry,
  error output, or synthetic fallback findings (#394).

- `@sovri/review-engine`: add scenario coverage that corrective retry success
  sets status `partial` without error output or synthetic fallback findings
  (#395).

- `@sovri/review-engine`: make exhausted parse-fallback Reviews expose a
  `could not parse` error while preserving the synthetic `review_failed`
  finding (#396).

- `@sovri/review-engine`: add scenario coverage that pre-LLM file-limit skips
  set failed status, zero token usage, and limit error text without provider
  calls (#397).

- `@sovri/review-engine`: add scenario coverage that provider rejections set
  failed status, zero token usage, and provider error text after one provider
  call (#398).

- `@sovri/review-engine`: re-export `buildInlineComments`,
  `InlineCommentDraftSchema`, and the `InlineCommentDraft` type from the
  package entrypoint so downstream consumers can build GitHub inline drafts
  without reaching into internal modules (#372).

### Changed

- `@sovri/review-engine`: `InlineCommentDraftSchema` now rejects payloads that
  provide only one of `start_line` / `start_side`, enforcing GitHub's
  multi-line comment contract at validation time instead of at API time
  (#372).

- `@sovri/review-engine`: add acceptance coverage that multi-line inline
  findings are skipped when any RIGHT-side line in the range is absent (#353).

- `@sovri/review-engine`: add acceptance coverage that findings targeting
  missing RIGHT-side diff lines are skipped without error (#352).

- `@sovri/review-engine`: add acceptance coverage that findings targeting
  files absent from the parsed diff are skipped without error (#351).

- `@sovri/review-engine`: add acceptance coverage that findings on
  existing RIGHT-side changed lines become inline comment drafts (#350).

- `@sovri/review-engine`: add acceptance coverage that inline comment
  drafts only expose GitHub review comment payload fields (#349).

- `@sovri/review-engine`: add acceptance coverage that malformed inline
  comment drafts missing `line` are rejected by the draft schema (#348).

- `@sovri/review-engine`: add acceptance coverage for Octokit-ready
  single-line inline comment draft payloads without deprecated `position`
  fields (#347).

- `@sovri/review-engine`: validate inline finding ranges before mapping
  them to GitHub review comment draft fields (#346).

- `@sovri/review-engine`: add acceptance coverage that reversed finding
  ranges fail validation before inline mapping (#346).

- `@sovri/review-engine`: add acceptance coverage that a two-line finding
  range is represented as a multi-line inline comment draft (#345).

- `@sovri/review-engine`: add acceptance coverage that a multi-line
  finding maps to `start_line`, `start_side`, ending `line`, and `side`
  fields (#344).

- `@sovri/review-engine`: add acceptance coverage that a single-line
  finding maps to a RIGHT-side `line` draft without range fields (#343).

- `@sovri/review-engine`: add fixture-backed acceptance coverage that inline
  comment generation is deterministic across repeated runs (#342).

- `@sovri/review-engine`: skip inline comment drafts when a finding range
  cannot be anchored to RIGHT-side diff lines (#341).

- `@sovri/review-engine`: add fixture-backed acceptance coverage for
  unanchorable inline findings returning no draft comments (#341).

- `@sovri/review-engine`: generate multi-line inline comment draft ranges
  with `start_line`, `start_side`, and ending `line` fields (#340).

- `@sovri/review-engine`: add fixture-backed acceptance coverage for
  multi-line inline comment draft generation (#340).

- `@sovri/review-engine`: add the inline comment draft schema for
  validating GitHub review comment payloads (#339).

- `@sovri/review-engine`: add fixture-backed acceptance coverage for
  single-line inline comment draft generation (#339).

- `@sovri/review-engine`: add acceptance coverage that empty inline finding
  input returns an empty draft list without error (#338).

- `@sovri/review-engine`: validate inline comment findings before
  generating drafts (#337).

- `@sovri/review-engine`: add acceptance coverage that invalid inline
  finding input fails validation without partial drafts (#337).

- `@sovri/review-engine`: add the initial inline comment draft generator
  for valid findings (#336).

- `@sovri/review-engine`: add acceptance coverage for converting valid
  findings into inline comment drafts (#336).

- `@sovri/review-engine`: add acceptance coverage that same-severity
  walkthrough findings use stable file, line, then title tie-break ordering
  (#310).

- `@sovri/review-engine`: add acceptance coverage that higher-severity
  walkthrough findings render before lower-severity findings even when the
  input array is reversed (#309).

- `@sovri/review-engine`: add acceptance coverage that shuffled
  walkthrough finding inputs produce identical deterministic markdown with no
  generated dates or identifiers (#308).

- `@sovri/review-engine`: add acceptance coverage that invalid
  walkthrough review inputs fail validation without returning partial markdown
  (#307).

- `@sovri/review-engine`: add acceptance coverage that valid no-finding
  reviews still return useful walkthrough markdown with summary and empty
  findings sections (#306).

- `@sovri/review-engine`: add acceptance coverage that valid reviews return
  markdown strings with TL;DR summary text and the empty-summary fallback
  (#305).

- `@sovri/review-engine`: add acceptance coverage that walkthrough
  structure checks reject markdown missing the File-by-file section (#304).

- `@sovri/review-engine`: add acceptance coverage that no-finding
  walkthroughs keep the required section structure and empty-state copy (#303).

- `@sovri/review-engine`: add acceptance coverage that Findings groups
  present severities in descending rank order from blocker through nitpick
  (#302).

- `@sovri/review-engine`: add acceptance coverage that multi-finding
  walkthroughs render the required Sovri review, TL;DR, Findings, and
  File-by-file sections in order (#301).

- `@sovri/review-engine`: add acceptance coverage that escaped file paths
  and table pipes stay safe in both Findings and File-by-file walkthrough
  sections (#300).

- `@sovri/review-engine`: add acceptance coverage that raw `<img>` HTML
  copied from a finding body is escaped in walkthrough markdown (#299).

- `@sovri/review-engine`: add acceptance coverage that walkthrough
  composition escapes user-controlled summary, finding title, finding body,
  and finding file values before rendering markdown (#298).

- `@sovri/review-engine`: add acceptance coverage that the File-by-file
  walkthrough summary repeats finding locations and titles under sorted files
  with per-file counts (#297).

- `@sovri/review-engine`: add acceptance coverage that finding detail
  completeness checks exercise `composeWalkthrough` output and reject
  walkthrough rows missing the explanatory body text (#296).

- `@sovri/review-engine`: add acceptance coverage that multiline finding
  bodies render as one markdown-safe paragraph without raw table-cell newlines
  or `<br>` tags (#295).

- `@sovri/review-engine`: add acceptance coverage that walkthrough findings
  render single-line and range locations with their titles and bodies (#294).

- `@sovri/review-engine`: add golden comparison coverage that layout drift
  fails with the affected golden fixture identified (#293).

- `@sovri/review-engine`: add golden fixture coverage that required TL;DR,
  Findings, and File-by-file walkthrough sections remain present (#292).

- `@sovri/review-engine`: render walkthrough markdown from golden-backed
  sections, including TL;DR, severity-grouped findings, file-by-file summaries,
  stable ordering, and HTML-safe table cells (#291).

- `@sovri/review-engine`: add golden walkthrough fixtures covering
  multi-finding, no-finding, HTML-escaping, and multiline-body review outputs
  (#291).

- `@sovri/review-engine`: add acceptance coverage that inline comment anchor
  rendering remains out of scope until the review input exposes trusted
  inline-comment URL metadata (#290).

- `@sovri/review-engine`: render finding bodies as one markdown-safe paragraph
  in walkthrough output while neutralizing markdown link delimiters for
  anchor-like user text, preserving brackets inside single- and multi-backtick
  inline code spans, treating escaped opening backticks as literal text, and
  preserving Markdown closing semantics inside code spans (#289).

- `@sovri/review-engine`: add acceptance coverage that anchor-like user text
  in finding bodies is rendered as inert markdown when no trusted inline-comment
  URL metadata exists (#289).

- `@sovri/review-engine`: add acceptance coverage for rejecting fabricated
  GitHub discussion links when review findings lack trusted inline-comment URL
  metadata (#288).

- `@sovri/review-engine`: make walkthrough composition accept validated review
  inputs and render finding titles without generated inline comment anchors
  (#287).

- `@sovri/review-engine`: add acceptance coverage that walkthrough
  composition does not invent inline comment anchors when review findings lack
  trusted inline-comment URL metadata (#287).

- `@sovri/review-engine`: add retry parsing for malformed or schema-invalid
  LLM responses, including corrective prompts with parse issue details,
  provider-raised parse failures, configurable retry budgets, and deterministic
  `review_failed` findings after exhausted retries (#260-#284).

- `@sovri/review-engine`: make retry parser acceptance test helpers fail fast
  when mock provider responses are exhausted (#260-#284).

- `@sovri/review-engine`: add the first acceptance test for LLM response
  parsing, requiring parsed LLM findings to receive UUID v4 identifiers and
  validate against the public `FindingSchema` (#201).

- `@sovri/review-engine`: add the initial LLM response parser and raw response
  schemas that convert parsed LLM findings into public `Finding` values with
  UUID v4 identifiers while keeping schema helper types internal to avoid
  unused public exports. The parser schema also tolerates the current provider
  response shape while preserving strict validation for unknown keys (#201).

- `@sovri/review-engine`: add acceptance coverage that multiple parsed LLM
  findings each receive a distinct UUID v4 identifier (#202).

- `@sovri/review-engine`: add acceptance coverage for rejecting non-v4 finding
  identifiers before a parsed finding can be returned (#203).

- `@sovri/review-engine`: return a committable suggestion when a raw finding
  contains a non-empty single-line replacement for a single-line location,
  while keeping empty or multiline replacements non-committable (#204).

- `@sovri/review-engine`: add acceptance coverage for marking multiline,
  empty, whitespace-only, and null suggestions as non-committable, including
  explicit `committable: false` assertions when a suggestion object is expected
  (#205).

- `@sovri/review-engine`: add acceptance coverage that `suggested_code: null`
  produces no public suggestion object while the returned finding still
  validates against `FindingSchema` (#206).

- `@sovri/review-engine`: omit the public suggestion object when
  `suggested_code` contains only whitespace, while preserving `FindingSchema`
  validation for the returned finding (#207).

- `@sovri/review-engine`: add acceptance coverage that a valid parser response
  with summary `Review completed` and file `src/review.ts` returns a
  `Finding[]` whose finding validates against `FindingSchema` (#208).

- `@sovri/review-engine`: throw a typed `LLMResponseParseError` for
  schema-violating LLM responses before any partial findings are returned
  (#209).

- `@sovri/review-engine`: add acceptance coverage that parser responses with
  101 findings fail with a typed findings limit validation error (#210).

- `@sovri/review-engine`: add acceptance coverage that parser tests fail with a
  schema-validation-specific error if raw LLM finding validation is bypassed
  (#211).

- `@sovri/review-engine`: add acceptance coverage that a valid response with
  summary `Two findings found` returns exactly two parsed findings (#212).

- `@sovri/review-engine`: add acceptance coverage that a valid response with
  summary `No findings found` returns an empty findings array (#213).

- `@sovri/review-engine`: add acceptance coverage that a valid response with
  exactly 100 findings is accepted and returns 100 parsed findings (#214).

- `@sovri/review-engine`: add acceptance coverage that a response with 101
  findings fails without partial output and exposes the findings limit failure
  on the typed parse error cause (#215).

- `@sovri/review-engine`: add raw LLM finding schema acceptance coverage for
  valid model-provided fields, optional CWE values, and explicit assertions
  that raw input fixtures and validated data omit deterministic `id` and
  `source` fields (#216).

- `@sovri/review-engine`: add raw LLM finding schema rejection coverage for
  `id` and `source` fields (parser-assigned, not model-provided) appearing
  as unknown keys in model output (#217).

- `@sovri/review-engine`: add raw LLM finding schema rejection coverage for
  invalid severity, category, file, line range, confidence, title length, and
  body length values (#218).

- `@sovri/review-engine`: add raw LLM finding schema rejection coverage for
  invalid optional CWE values on the `cwe` path (#219).

- `@sovri/review-engine`: allow `parseLLMResponse` to accept raw JSON string
  inputs and parse them into public `Finding[]` values (#220).

- `@sovri/review-engine`: add acceptance coverage that already-parsed unknown
  object inputs still parse into public `Finding[]` values (#221).

- `@sovri/review-engine`: add acceptance coverage that malformed raw JSON
  string inputs fail with a typed parse error retaining the JSON syntax cause
  (#222).

- `@sovri/review-engine`: add acceptance coverage that schema-violating
  parsed object inputs fail with a typed parse error retaining the Zod cause
  (#223).

- `@sovri/review-engine`: add acceptance coverage that non-object parsed inputs
  fail with a typed parse error retaining the Zod cause (#224).

- `@sovri/review-engine`: add top-level LLM response schema acceptance coverage
  for a strict response with summary `Review completed` and one raw finding
  (#225).

- `@sovri/review-engine`: add top-level LLM response schema rejection coverage
  for empty and 2001-character summaries (#226).

- `@sovri/review-engine`: add top-level LLM response schema rejection coverage
  for unknown fields such as `model_notes` (#227).

- `@sovri/review-engine`: add top-level LLM response schema rejection coverage
  for missing required `summary` and `findings` fields (#228).

- `@sovri/review-engine`: add top-level LLM response schema boundary coverage
  for summaries with exactly 2000 JavaScript string characters (#229).

### Fixed

- `apps/community-bot`: fetch pull request diffs from the delivered
  `base_sha...head_sha` comparison and keep invalid pull request webhook
  payloads inside correlated failure logging instead of escaping before the
  handler error path (#41).

- `apps/community-bot`: derive PR review inline comments from the review
  engine's diff-anchored drafts so unanchorable findings cannot make GitHub
  reject the entire review request (#41).

- `apps/community-bot`: load repository `.sovri.yml` from the delivered base
  commit SHA so review config and diff inputs use the same webhook snapshot
  (#41).

- `apps/community-bot`: scaffold tests now exercise the real validators
  (CodeRabbit + cubic-dev review on #452). `inspectManifestAccess` enforces
  the manifest `name` field, and the layout scenario routes presence checks
  through a new `inspectLayoutPresence` helper instead of re-deriving the
  missing element from the same input list.

- `apps/community-bot`: `dev` script targets the compiled `dist/app.js`
  instead of `src/app.ts` (Codex review on #452). The TypeScript sources use
  ESM `.js` import specifiers that Probot's CLI cannot resolve against the
  raw `src/` tree, so the previous script failed in a clean checkout. The
  script now runs `tsup` then `probot run ./dist/app.js`.

- `@sovri/review-engine`: `normalizeFindingPath` no longer rewrites provider
  finding paths whose repository-relative form merely contains an ignore-rule
  prefix mid-path (#427, Codex + cubic-dev review). The previous
  `findIgnoredSuffix` heuristic used `indexOf`/`slice`, so an ignore pattern
  like `src/**` would rewrite `packages/review-engine/src/orchestrator.ts` to
  `src/orchestrator.ts` and silently drop a valid finding. Findings now keep
  their normalized repository-relative path and only match ignore globs
  literally.

### Removed

- `@sovri/llm-providers`: `zod-to-json-schema@3.25.2` runtime dependency
  introduced by the package scaffold (#27) is dropped in favour of Zod 4's
  native `z.toJSONSchema()` (#28). The third-party converter still types
  its `schema` parameter as the v3 `ZodSchema`, which would have forced an
  unsafe cast to feed a Zod 4 schema and contravenes the strict-mode rule
  banning unjustified `as` casts. Shrinking the transitive dependency
  surface also reduces the supply-chain blast radius (mini-shai-hulud
  rationale, ADR-005). The matching entry in `knip.json` for the package
  is removed alongside the dependency.

### Security

- `@sovri/review-engine`: `buildUserPrompt()` now fences and escapes pull
  request repository, title, description, and unified diff content as user data
  before they enter the provider prompt, blocking PR metadata from injecting
  prompt directives outside the protected diff section (#155).

- `@sovri/review-engine`: runtime prompt composition now keeps escaped unified
  diffs inside a fenced `diff` block after routing through `buildUserPrompt()`,
  preserving delimiter protection while still including pull request metadata
  in the provider request (#155).

- `@sovri/review-engine`: `buildReviewPrompt` now escapes triple-backtick
  sequences inside `unifiedDiff` before interpolating into the fenced `diff`
  block (#134, cubic-dev review). A diff containing ``` could otherwise close
  the prompt fence and inject downstream instructions into the LLM context,
  matching the prompt-injection surface called out in `CLAUDE.md` (review IA
  attack surface).
- `@sovri/review-engine`: `ProviderFindingSchema` now refuses inverted ranges
  via a `.refine(line_end >= line_start)` cross-field check (#134, CodeRabbit
  + cubic-dev review). Without the guard the LLM could produce
  `line_end < line_start` and the bot would either post a degenerate inline
  comment or rely on downstream code to silently swap the bounds.

- `@sovri/llm-providers`: `LLMFindingSchema` and `LLMResponseSchema` are
  hardened against prompt-injected LLM output (#28). The diff entering the
  prompt is untrusted; the response re-enters the bot as untrusted JSON
  and is the canonical injection surface. Mitigations:
  - `file` rejects absolute paths, `..` traversal segments, NUL/CR/LF, and
    Windows drive separators via a strict regex — closing the
    Octokit `createReviewComment({ path })` / local-fs-read path-traversal
    sink class that affected similar review bots.
  - `line_start` and `line_end` are capped at `1_000_000`, with a
    `superRefine` enforcing `line_start <= line_end`, blocking 2-billion-row
    expansions and nonsensical inline comments.
  - `walkthrough_markdown` is bounded `[1, 50_000]` chars, staying under
    GitHub's 65 536 PR-comment hard limit with headroom; empty values are
    rejected so degenerate output fails loud at parse time.
  - `findings` array is capped at 100 per response, blocking LLM-driven
    GitHub API rate-limit exhaustion (each finding posts a separate inline
    comment) and worker memory exhaustion in the stateless v0.1 bot.
  - Both schemas switch to `z.strictObject(...)`: unknown keys from the
    LLM are now rejected at parse time instead of silently stripped, which
    surfaces prompt-template drift early and removes the key-smuggling
    vector for downstream code that may later spread the parsed object.
  - `CwePattern` tightened to `^CWE-\d{1,7}$` (CWE IDs are ≤ 6 digits today)
    to cap string length on the optional `cwe` field.

### Changed

- `@sovri/llm-providers`: `LLMProvider` interface now exposes a `readonly
  model: string` field so callers can record the model that actually produced
  a generation (#134, Codex + cubic-dev review). `AnthropicProvider` already
  carried this field; the change just promotes it to the cross-provider
  contract.
- `@sovri/review-engine`: `runReview` now sources `ReviewEngineResult.model`
  from `options.provider.model` instead of `RunReviewInput.model`, and the
  unused `model` key is dropped from `RunReviewInputSchema` (#134, Codex +
  cubic-dev review). The previous shape let the caller record an arbitrary
  model string that did not have to match the provider, skewing audit and
  cost attribution. Removing the field also fixes a latent strict-schema
  failure: `buildReviewPrompt` calls `ReviewPromptInputSchema.parse(input)`
  in strict mode and would reject the now-unexpected `model` key.

- `@sovri/llm-providers`: `AnthropicProvider` retry policy now mirrors the
  Anthropic SDK's documented transient set — HTTP 408 (request timeout),
  409 (lock timeout), 429 (rate limit), and any 5xx including 529 (overloaded
  during capacity events). Previously only 429 and 503 retried, so capacity
  events that surface as 529 or other 5xx failed immediately because the
  adapter also forces `maxRetries: 0` on the SDK client. `resolveTimeoutMs`
  now also rejects values above `MAX_ANTHROPIC_TIMEOUT_MS` (2,147,483,647 ms)
  to stop Node's `setTimeout` from clamping oversized delays to ~1 ms and
  aborting the request before it leaves the event loop.

- `@sovri/llm-providers`: `zodToProviderJsonSchema` now pins `cycles: "ref"`
  and `unrepresentable: "throw"` explicitly in addition to the existing
  `target: "draft-2020-12"` and `reused: "inline"` (#28). The values match
  Zod 4's current defaults but are documented in code so a future Zod
  default change cannot silently relax the contract: recursive schemas
  still emit `$ref` rather than looping forever, and unrepresentable
  shapes (e.g. `z.function()`) still throw at build time instead of
  producing `{}` that an LLM would silently honour.

### Fixed

- `@sovri/review-engine`: walkthrough finding ordering now uses code-point
  comparison instead of `localeCompare`, so the rendered markdown is identical
  across hosts regardless of ICU locale (e.g. `a.ts` always sorts before
  `ä.ts`). Regression covered in stable-ordering-tiebreak.test.ts (#335,
  codex review).

- `@sovri/review-engine`: `formatMarkdownText` no longer HTML-escapes
  characters inside inline code spans, so finding text like `` `<button>` ``
  or `` `a && b` `` renders verbatim instead of leaking `&lt;`, `&gt;`, and
  `&amp;` entities into rendered code (#335, codex review).

- `@sovri/review-engine`: `composeWalkthrough` now renders the trimmed summary
  in TL;DR instead of the raw input, so leading/trailing whitespace cannot leak
  into the output (#335, coderabbit + cubic-dev review).

- `@sovri/review-engine`: `compareFindingsWithinFile` now compares raw `title`
  and `body` fields and falls back to `line_end` then `id`, so distinct
  findings sharing file/line/title no longer rely on input order — ordering is
  total and stable under shuffled inputs (#335, codex + coderabbit + cubic-dev
  review).

- `@sovri/review-engine`: walkthrough golden fixture `multi-finding` summary
  text corrected from "Five" to "Three" review findings to match the actual
  fixture count (#335, coderabbit review).

- `@sovri/core`: `FindingSchema.id` now requires UUID v4 instead of accepting
  any syntactically valid UUID version, so parser regressions that assign older
  UUID versions are rejected before a `Finding` can be returned (#203).

- `@sovri/review-engine`: `runReview` now routes prompt generation through
  `buildUserPrompt()` with validated pull request metadata, so the runtime
  provider request uses the same title, description, and diff prompt contract
  covered by the #155 acceptance scenario.

- `@sovri/review-engine`: `parseUnifiedDiff` now rejects inputs that do not
  contain a `diff --git ` file header instead of returning files with empty
  `patch` strings (#154, cubic-dev review). Plain unified diffs still parse via
  `parse-diff` but our `splitFilePatches` only recognises Git headers, so
  accepting them silently produced lossy `FileChange` entries. Non-empty input
  without a Git header now throws `DiffParseError`.

- `@sovri/review-engine`: `normalizeGitPath` no longer strips a leading `a/`
  or `b/` prefix (#154, Codex review). `parse-diff@0.12.0` already removes one
  Git prefix in `parseFiles`/`parseOldOrNewFile`, so the second strip mangled
  real paths under top-level `a/` or `b/` directories — `a/config.ts` was
  emitted as `config.ts`, attaching findings to the wrong file. Mapping tests
  updated to feed already-stripped paths and cover the regression.

- `@sovri/review-engine`: `parser.fixtures.test.ts` "fails when a required
  fixture is missing" guard now asserts `missingFixtures` is empty rather than
  only checking `binary.diff`, so any absent fixture fails the suite
  (#154, CodeRabbit review).

- `@sovri/llm-providers`: `createAnthropicMessageWithRetry` now enforces the
  configured timeout as a single absolute deadline shared across retry attempts
  (#123). Previously each attempt restarted the full per-call timeout budget,
  so a 60 s timeout could hold the request open for ~3 × 60 s plus retry sleeps
  before aborting. The deadline is computed once on entry; each attempt passes
  the remaining budget to the SDK and the AbortController, and a retry sleep
  that would push past the deadline now short-circuits to a typed
  `AnthropicTimeoutError` instead of issuing a doomed extra request.

- `@sovri/llm-providers`: normalize Anthropic HTTP 401 terminal failures with
  the same safe HTTP-status message shape used by other non-retryable provider
  responses while preserving the typed auth error and attempt metadata (#104).

- `lefthook`: drop `--noEmit` from the `ts-typecheck` pre-commit hook so
  the workspace `tsc -b` no longer trips TS6310 ("Referenced project may
  not disable emit") on composite project references. The flag was
  incompatible with the `composite: true` setup in `packages/*` and
  blocked every commit that touched a referencing package. Aligned with
  the pre-push `ts-typecheck` line which already runs the emitting form.

- `@sovri/llm-providers`: `AnthropicProvider` no longer requires
  `ANTHROPIC_API_KEY` when an explicit `client` is injected via constructor
  options (#29, Codex/cubic-dev review on #92). The env read is deferred to
  the `??`-right branch so injected SDK clients (unit tests, custom
  transports, BYO-auth wrappers) are not blocked by the env-var guard. Auth
  validation is unchanged when the SDK is constructed internally.

- `@sovri/llm-providers`: preserve literal custom error `name` types for
  discriminated narrowing and normalize Anthropic SDK transport timeouts as
  `AnthropicTimeoutError` in the provider-owned retry path (#30).

- `@sovri/llm-providers`: retry transient Anthropic SDK
  `APIConnectionError` transport failures in the provider-owned retry path
  now that SDK retries are disabled per request (#30).

- `@sovri/llm-providers`: schedule the provider-owned abort timer after the
  SDK call has registered its signal handling so a response completing exactly
  at the configured timeout deadline succeeds, while a response after the
  deadline still times out (#100).

- `@sovri/llm-providers`: replace the raw NUL byte in
  `LLMResponseSchema.test.ts` (control-byte path test) with the
  ` ` escape sequence so Git classifies the file as UTF-8
  text instead of binary (#28, Codex review on #91). Test semantics
  unchanged — TypeScript still produces the same NUL-containing string
  literal at runtime, but text-based diff/review tooling now works.

- `@sovri/config`: `loadConfig()` no longer throws when `.sovri.yml`
  vanishes between the `fs.stat` and the `fs.readFile` syscalls (#26).
  The read path now mirrors the stat-time fallback and returns
  `DEFAULT_CONFIG` on `ENOENT`/`ENOTDIR`, with regression tests driving
  the new branch via a `vi.mock` factory.

### Added

- `@sovri/review-engine`: acceptance coverage now explicitly asserts missing
  pull request descriptions render as `(none)` in the description section while
  diff content remains after prompt metadata (#176).

- `@sovri/review-engine`: acceptance coverage for oversized system prompt
  templates now asserts the failure message identifies the 1024-byte UTF-8
  limit (#175).

- `@sovri/review-engine`: acceptance coverage for prompt metadata escaping now
  reports the specific unsafe raw directive marker when a regression removes
  escaping from `buildUserPrompt()` (#174).

- `@sovri/review-engine`: acceptance coverage now explicitly asserts the
  prompt builder output-shape contract across `buildSystemPrompt()` and
  `buildUserPrompt()`, including non-empty system prompts, PR metadata, and
  diff content (#173).

- `@sovri/review-engine`: acceptance coverage now asserts code fences embedded
  in diff content are escaped before the first closing diff fence and raw
  instruction markers are escaped in `buildUserPrompt()` (#172).

- `@sovri/review-engine`: acceptance coverage now asserts markdown instruction
  text supplied through diff content remains inside quoted user-data sections
  and cannot enter the prompt instruction section (#171).

- `@sovri/review-engine`: acceptance coverage now asserts markdown supplied in
  PR title, PR description, or diff content appears only inside quoted
  user-data sections of `buildUserPrompt()` (#170).

- `@sovri/review-engine`: acceptance coverage now asserts regular markdown
  diff content remains inside the quoted diff user-data section and is not
  promoted into the prompt instruction section (#169).

- `@sovri/review-engine`: acceptance coverage now asserts missing and empty
  pull request descriptions render as `(none)` while diff content remains after
  the metadata section in `buildUserPrompt()` (#179).

- `@sovri/review-engine`: acceptance coverage now asserts prompt contract
  failures identify missing diff content when a regression omits the diff from
  `buildUserPrompt()` (#168).

- `@sovri/review-engine`: acceptance coverage now asserts `buildUserPrompt()`
  includes pull request repository, number, title, description, diff path, and
  added diff lines in the user prompt (#178).

- `@sovri/review-engine`: acceptance coverage now asserts repeated full-mode
  system prompt builds return identical template strings without runtime pull
  request data (#165).

- `@sovri/review-engine`: `buildSystemPrompt()` now validates external
  configuration input at runtime and acceptance coverage asserts unsupported
  review modes fail before any fallback system template is returned (#164).

- `@sovri/review-engine`: acceptance coverage now asserts
  `buildSystemPrompt({ mode: "full" })` returns the baseline static template,
  requests code review and structured JSON findings, and excludes runtime pull
  request data from the system prompt (#163).

- `@sovri/review-engine`: acceptance coverage now asserts non-ASCII system
  prompt template content is measured by UTF-8 bytes, including `é` as a
  two-byte character (#161).

- `@sovri/review-engine`: acceptance coverage now asserts the exact system
  prompt template byte boundary accepts 1023 and 1024 UTF-8 bytes while
  rejecting 1025 bytes (#177).

- `@sovri/review-engine`: system prompt template validation now enforces the
  1024-byte UTF-8 budget with a typed `PromptTemplateSizeError` before a prompt
  can be returned (#156).

- `@sovri/review-engine`: acceptance coverage now asserts oversized system
  prompt templates fail construction instead of returning a prompt over the
  1024-byte budget (#156).

- `@sovri/review-engine`: `buildSystemPrompt({ mode: "full" })` now exposes
  the compact v0.1 baseline system template, and `buildReviewPrompt()` reuses
  that builder for runtime prompt composition (#159).

- `@sovri/review-engine`: acceptance coverage now asserts the v0.1 full system
  prompt template stays within the 1024-byte UTF-8 budget while diff content
  remains in the user prompt (#159).

- `@sovri/review-engine`: acceptance coverage now asserts directive markers in
  diff content are escaped without hiding the changed line from review (#157).

- `@sovri/review-engine`: acceptance coverage starts for the v0.1 prompt
  builder user prompt contract, and `buildUserPrompt()` now preserves safe PR
  metadata and diff content in the generated review prompt (#155).

- `@sovri/review-engine`: `parseUnifiedDiff(raw)` now converts unified Git diff
  text into the normalized `@sovri/core` `DiffSchema` contract (#32). The parser
  validates parse-diff output with Zod, preserves binary file entries with
  skipped content, normalizes Git path prefixes, records rename metadata,
  maps deletions to `removed`, falls back to a deterministic unknown SHA for
  abbreviated or missing blob IDs, and wraps malformed or invalid parser output
  in a typed `DiffParseError`.

- `@sovri/review-engine`: package scaffold for the v0.1 orchestration layer
  (#31). The package now builds with tsup, participates in the workspace
  TypeScript project references, and exposes dedicated modules for diff
  parsing, prompt building, LLM response parsing, walkthrough composition,
  and orchestration while keeping the deferred ingestion format out of the
  v0.1 source surface.

- `@sovri/llm-providers`: acceptance coverage confirms the first two
  Anthropic retry delays remain inside their jitter windows: 400 ms to 600 ms
  for the 500 ms base delay and 800 ms to 1200 ms for the 1000 ms second
  retry delay (#110).

- `@sovri/llm-providers`: acceptance coverage confirms the first Anthropic
  retry delay remains inside the configured 400 ms to 600 ms jitter window
  around the 500 ms base delay (#108).

- `@sovri/llm-providers`: acceptance coverage confirms non-transient
  Anthropic HTTP 400, 401, 403, 404, and 422 responses fail immediately
  without retrying (#107).

- `@sovri/llm-providers`: acceptance coverage confirms immediate
  non-retryable Anthropic HTTP 401 failures record the single 30 ms attempt
  duration and do not retry (#102).

- `@sovri/llm-providers`: acceptance coverage confirms exhausted transient
  Anthropic failures preserve every attempt duration from the three total
  HTTP 503 attempts and surface the typed retry error message (#101).

- `@sovri/llm-providers`: acceptance coverage for the default Anthropic
  request timeout confirms that an adapter created without an explicit
  timeout passes the 60 s default to the SDK call while still returning a
  completion that arrives before the deadline (#97).

- `@sovri/llm-providers`: acceptance coverage for custom Anthropic request
  timeouts confirms that a configured 1500 ms timeout is passed to the SDK
  call while still returning a completion that arrives at 1000 ms (#99).

- `@sovri/llm-providers`: `AnthropicProvider` now applies provider-owned
  retry and timeout controls for structured-output calls (#30). Documented
  transient Anthropic failures retry with three total attempts, 500 ms /
  1000 ms exponential backoff, and bounded jitter to avoid retry bursts. Each
  request uses an `AbortController` timeout defaulting to 60 s and disables
  the Anthropic SDK's built-in retries so Sovri owns the retry contract.
  Final failures now expose typed retry/timeout errors and attempt duration
  metadata without logging raw provider payloads.

- `@sovri/llm-providers`: `AnthropicProvider` now implements the shared
  `LLMProvider` contract for v0.1 (#29). It reads `ANTHROPIC_API_KEY` from
  the process environment, rejects missing or blank keys with
  `AnthropicAuthError`, sends Claude Sonnet structured-output requests through
  the official Anthropic SDK using the current `output_config.format`
  `json_schema` API, applies Anthropic's JSON Schema transform to the shared
  provider schema helper output, caps `maxTokens` overrides, parses the
  returned text as JSON, and validates it against the caller's Zod schema
  before returning. Malformed JSON, schema mismatches, bad provider response
  shapes, and API failures are wrapped in `AnthropicResponseError` with safe
  status/request metadata only; 401s are surfaced as `AnthropicAuthError`.
  MSW-backed integration tests cover the happy path, missing key, rejected
  key, malformed JSON, schema mismatch, invalid token limits, and transformed
  schema shape without real network calls or real secrets.

- `@sovri/llm-providers`: `LLMProvider` interface (`name`, `maxTokens`,
  `generateStructured<T>(...)`) per ARCHI.md §4.3, plus `LLMFindingSchema`
  / `LLMResponseSchema` (the structured-output shape the LLM returns before
  the review-engine assigns deterministic `id`/`source`/`confidence`) and
  the internal `zodToProviderJsonSchema` helper that maps any Zod schema to
  a JSON Schema draft 2020-12 payload usable in Anthropic
  `tools[].input_schema` or Mistral / OpenAI-compatible
  `response_format.json_schema.schema` (#28). The helper relies on Zod 4's
  native `z.toJSONSchema()` and inlines reused subschemas
  (`reused: "inline"`) because several providers fail to resolve `$ref`
  reliably; provider-specific tweaks such as OpenAI strict mode's
  recursive `additionalProperties: false` stay in the adapter layer. The
  inline `LLMFindingSchema` reuses `@sovri/core`'s `SeveritySchema` and
  `CategorySchema` so the LLM cannot drift the enum surface independently
  of the domain. No concrete provider lands in this task — `AnthropicProvider`
  ships in #29.

- `@sovri/llm-providers` package scaffold (#27) — Apache 2.0 package that
  anchors BYOK LLM adapter slot in the v0.1 sprint plan. Exposes the same
  `tsup`/`tsc -b`/`vitest`/`oxlint` quartet of scripts as the existing
  packages and ships a placeholder `src/index.ts` until the
  `LLMProvider` contract lands (#28). Runtime deps:
  `@anthropic-ai/sdk@0.96.0` (PINNED EXACT per ADR-005 supply-chain
  rule, post-dates the mini-shai-hulud incident of 2026-05-11),
  `zod-to-json-schema@3.25.2` (also pinned via `.npmrc save-exact=true`),
  `zod@4.4.3`, and workspace deps `@sovri/core` + `@sovri/observability`.
  No Mistral or OpenAI SDK ships — those land in v0.5 alongside the
  multi-provider scope. Root `tsconfig.json` references and `knip.json`
  overrides updated; the dependency ignore-list in `knip.json` will be
  removed in #28 once the imports become live.

- `@sovri/config`: `loadConfig(repoRoot)` — async reader/validator for
  `.sovri.yml` (#26). Resolves the four documented outcomes from the issue
  contract: missing file (`ENOENT`/`ENOTDIR`) or YAML root of `null`/
  `undefined` (empty file, comments only) returns `DEFAULT_CONFIG`;
  malformed YAML throws `SovriConfigParseError` with the underlying
  `YAMLException` in `cause`; schema violations throw
  `SovriConfigValidationError` carrying the full Zod issue list. Pino
  debug logs at every branch via `@sovri/observability` so an operator
  can trace which path fired without recompiling. Hardening: a 64 KiB
  byte-size cap (`MAX_CONFIG_BYTES`) checked via `fs.stat` before the
  parser ever sees the input, blocking trivially oversized payloads
  during webhook processing; `DEFAULT_CONFIG` is deep-frozen so a misuse
  in any downstream package cannot poison the shared singleton across
  every subsequent review. `SovriConfigParseError` and
  `SovriConfigValidationError` extend `Error` with the ES2022 `cause`
  option and expose `filePath` plus (for the validation case) the parsed
  Zod `issues` array, ready for a PR-comment renderer to surface
  actionable diagnostics. Real `.sovri.yml` fixtures live under
  `packages/config/test-fixtures/` (valid, empty, comments-only,
  malformed, two distinct schema violations); the test suite exercises
  every branch above 86 % including the v0.1 `.refine()` narrowing that
  rejects non-`anthropic` providers. Residual YAML-bomb risk via deeply
  nested anchors/aliases is acknowledged in the loader docstring and
  deferred to a follow-up that swaps the parser or adds an alias-count
  guard.

- `@sovri/config`: `SovriConfigSchema` — v0.1 minimal `.sovri.yml` shape
  (#25). Materialises the schema sketched in `ARCHI.md` §4.4 with strict
  rejection of unknown keys at every nesting level (`z.strictObject`),
  inferred `SovriConfig` type via `z.infer`, and named enum schemas
  `ProviderSchema` / `ReviewModeSchema` / `SeverityThresholdSchema`. The
  provider enum stays wide (`anthropic | mistral | openai |
  openai-compatible`) so the inferred type is stable across releases; a
  Zod refinement narrows runtime acceptance to `anthropic` in this
  release. Boundary hardening: `apiKeySecret` enforces an
  `UPPER_SNAKE_CASE` env-var-name regex so a real key pasted by mistake
  is rejected before it can leak into logs, `baseUrl` is restricted to
  `https` only (no `javascript:`, `data:`, `file:`, or `http:` schemes),
  `model` is restricted to a safe character set blocking newlines, NUL
  bytes, and Unicode bidi overrides, and every string / array field
  carries an explicit `.max()` to neutralise the YAML-as-DoS vector.
  Defaults: `review` and `limits` blocks may be omitted entirely and
  resolve to `{ mode: "full", autoReviewDrafts: false, severityThreshold:
  "minor" }` and `{ maxFilesPerReview: 50, maxLinesPerReview: 5000 }`
  respectively via Zod 4's `.prefault({})`; `ignores` defaults to `[]`.
  The `sarif` block from `ARCHI.md` §4.4 plus `loadConfig` /
  `mergeWithOrgOverride` are intentionally deferred to v0.5.

- `@sovri/config` package scaffold (#24) — Apache 2.0 package that anchors
  the `.sovri.yml` parser surface landing in follow-up tasks. Ships
  `package.json` (name `@sovri/config`, exact-pinned runtime dependencies
  `zod@4.4.3` and `js-yaml@4.1.1` plus `workspace:*` links to `@sovri/core`
  and `@sovri/observability`), `tsconfig.json` extending `tsconfig.base.json`
  with composite project references to `@sovri/core` and
  `@sovri/observability` so `tsc -b` schedules dependency builds first in
  a clean workspace, `tsup.config.ts` mirroring the existing package
  shape, a barrel `src/index.ts` exporting a permissive placeholder
  `SovriConfigSchema` (`z.object({}).passthrough()`) plus type-only
  re-exports of `Severity` and `Logger` from the workspace, and a README.
  The barrel imports `z` from `@sovri/core` (not `zod` directly) so the
  package binds to the workspace's shared Zod instance. Root
  `tsconfig.json` gains a project reference so `tsc -b` walks the
  package; `knip.json` gets a workspace block that scopes the entry to
  `src/index.ts` and whitelists `js-yaml` / `@types/js-yaml` / `zod`
  (declared per issue requirements but consumed only in follow-up tasks).

- `@sovri/observability`: `createLogger(name)` factory built on Pino v9 with structured JSON output; reads `LOG_LEVEL`, `LOG_PRETTY`, `SERVICE_NAME`, `SERVICE_VERSION`, `NODE_ENV`; attaches `{ service, version, env }` to every record and `{ component: name }` to child loggers. (#22)

- `@sovri/observability` package scaffold (#21) — Apache 2.0 package that
  anchors the dependency graph entry point for the Pino logger landing in a
  follow-up task. Ships `package.json` (name `@sovri/observability`,
  `pino@9.14.0` as the only runtime dependency, exact-pinned per supply
  chain policy), `tsconfig.json` extending `tsconfig.base.json`,
  `tsup.config.ts` mirroring `@sovri/core`'s ESM-only bundler shape, a
  barrel `src/index.ts` that re-exports only Pino's `Logger` type so
  downstream consumers can already wire the future logger's return type at
  compile time (no runtime symbols yet — `unicorn/require-module-specifiers`
  rejects a bare `export {}` and the type-only re-export keeps the file a
  valid TS module under `isolatedModules`), an `src/index.test.ts` that
  asserts the barrel resolves at runtime via `expect(...).toBeTypeOf` (the
  runtime check `expectTypeOf` cannot provide without `vitest --typecheck`)
  and that the exported `Logger` type structurally equals `pino`'s `Logger`
  via `expectTypeOf`, and a README pointing at ADR-006. Per ADR-006 no `@opentelemetry/*` dependency is introduced —
  OpenTelemetry SDK 2.0 is intentionally deferred to v0.5 and lands
  alongside the `createLogger` factory described in `ARCHI.md` §4.5
  without breaking the package's public API. The root `tsconfig.json`
  gains a project reference so `tsc -b` typechecks the new package.

- `@sovri/core` domain helpers `computeSeverityRank`,
  `groupFindingsByFile`, `applyIgnoreRules` (#20) — pure functions used by
  the review engine and bot to rank, bucket, and filter findings prior to
  walkthrough rendering. Materialises the three helpers listed in
  `ARCHI.md` §4.1 as Apache 2.0 source colocated with the existing Zod
  schemas under `packages/core/src/helpers/`, each paired with its own
  test file that exercises every branch (vitest reports 100 %
  statements/branches/functions/lines on the package).

  `computeSeverityRank(severity)` returns a `SeverityRank` literal in the
  closed interval `1..5` mapping `blocker → 5`, `major → 4`, `minor → 3`,
  `info → 2`, `nitpick → 1`. The mapping is declared with
  `as const satisfies Record<Severity, number>` so the compiler refuses
  to build if a new severity is ever added to `SeveritySchema` without a
  rank, and so the inferred return type is the literal union rather than
  the wider `number`.

  `groupFindingsByFile(findings)` returns
  `Readonly<Record<string, readonly Finding[]>>` with keys in ascending
  code-point order and findings preserving their original input order
  within each bucket. Sorting goes through the small exported helper
  `compareFilePaths(a, b)` so the three-way comparator contract (must
  return `0` for equal pairs) stays exhaustively tested even though the
  caller — backed by a `Map` — never actually feeds it duplicate keys.
  The return type is deeply readonly to prevent downstream consumers
  from mutating shared buckets, and a regression test pins that file
  paths equal to `"__proto__"` land as own properties without polluting
  `Object.prototype`.

  `applyIgnoreRules(findings, ignores)` filters out findings whose
  `file` matches at least one POSIX glob in `ignores`, returning
  `readonly Finding[]`. The matcher is `node:path`'s
  `path.posix.matchesGlob` (marked stable in Node v24.8.0 — the new
  workspace `engines.node` floor lands in the same PR), which keeps the
  package at zero runtime dependencies beyond Zod — the project rule
  forbidding any non-Zod runtime dep is honoured. Surprising semantics
  worth flagging to reviewers: glob metacharacters in the file path are
  treated literally (only the second argument is parsed as a pattern),
  malformed patterns like `[` are silently no-matches rather than
  throwing, and `**` does not capture leading `../` traversal segments —
  callers must normalise paths upstream. Each of these behaviours has a
  dedicated test that pins it against future Node releases.

  `packages/core/src/index.ts` re-exports the three helpers and the
  `SeverityRank` type from the package barrel; the corresponding smoke
  tests in `src/index.test.ts` confirm each export is reachable through
  the public entrypoint after the tsup build.

- `@sovri/core` declares `@types/node` 24.12.4 as a pinned devDependency
  (#20) and the package `tsconfig.json` opts in to `"types": ["node"]`
  so the new `node:path` import in `applyIgnoreRules` resolves under
  TypeScript 6 with `NodeNext` module resolution. The dependency is
  type-only (no shipped artifact, `files` still ships `dist/` and
  `README.md` only) so the "Zod uniquement" rule for runtime
  dependencies remains intact. A follow-up will narrow the type surface
  via a project-level lint rule banning `node:fs`, `node:net`,
  `node:http`, `node:os`, and `node:child_process` imports anywhere
  under `packages/core/` so the compile-time I/O barrier the rule
  enforces is preserved.

- `@sovri/core` package scaffold (#16) — first real workspace member
  under `packages/*`, materialising the pure-domain layer described in
  `docs/adr/005-zod-runtime-validation.md` and
  `docs/adr/008-tsup-bundler.md`. Seven files land together so the
  package is internally consistent on its first commit, and the legacy
  `packages/README.md` placeholder introduced by #15 is removed in the
  same PR (see the matching `### Removed` entry below).

  `packages/core/package.json` declares `name: "@sovri/core"`,
  `version: "0.1.0"`, `private: true`, `license: "Apache-2.0"`,
  `type: "module"`, `sideEffects: false` (per
  `docs/adr/008-tsup-bundler.md` "Tree-shaking" rationale, so downstream
  bundlers can prove the re-export is side-effect-free), an `exports`
  map pointing at `./dist/index.js` + `./dist/index.d.ts` (the two
  artifacts the issue #16 acceptance criteria require
  `pnpm --filter @sovri/core build` to produce), `files: ["dist",
  "README.md"]` so the published tarball stays minimal, `engines`
  mirroring the root (`node >=24.0.0 <25.0.0`, `pnpm >=10.0.0 <11.0.0`),
  and four scripts (`build` → `tsup`, `test` →
  `vitest run --passWithNoTests`, `lint` →
  `oxlint . --max-warnings=0 --no-error-on-unmatched-pattern`,
  `typecheck` → `tsc -b --noEmit`) that match the four Turborepo
  pipelines declared at `turbo.json` lines 5-44 so
  `pnpm turbo build|test|lint|typecheck` resolve per-package without
  further wiring. The legacy `main` and `types` top-level keys are
  intentionally omitted — `exports."."` is the single source of truth
  for both the JS and types resolutions, and any future shape change
  there will not silently leave a stale duplicate behind.

  `packages/core/tsconfig.json` extends `../../tsconfig.base.json` and
  adds `composite: true` (required for TypeScript project references —
  without it the new `{ "path": "./packages/core" }` entry added to the
  root `tsconfig.json` `references` array is silently skipped by
  `tsc -b` and the pre-commit `ts-typecheck` hook would pass against a
  broken package), `rootDir: "./src"`, `outDir: "./.tsbuild"`, and
  `emitDeclarationOnly: true`. The non-default `outDir` matters: the
  pre-push lefthook block runs `tsc -b` (full emit) and
  `pnpm turbo build` (which invokes tsup) in parallel, and if both
  emitters share `./dist` they race on the same files. Pointing tsc at
  `./.tsbuild` (added to `.gitignore` alongside the existing `dist/`
  rule) leaves tsup as the sole writer to `./dist` and the package's
  declared `exports` paths, eliminating the race entirely.
  `emitDeclarationOnly: true` skips the unused tsc-side `.js` emit
  since tsup owns the JS bundle. `exclude: ["dist", ".tsbuild",
  "node_modules", "**/*.test.ts", "**/*.spec.ts"]` keeps tsc focused on
  production sources (test files are still type-checked through
  Vitest's runner-side TypeScript pass against the same compiler
  options).

  `packages/core/tsup.config.ts` matches the ADR-008 sample
  (`format: ['esm']`, `dts: …`, `clean: true`, `sourcemap: true`,
  `treeshake: true`) and adds two explicit overrides documented by the
  current tsup 8.x docs — `splitting: false` (the ESM default is
  `true`, which would emit chunk files alongside `index.js` and break
  the single-artifact contract the `exports` map declares) and
  `outDir: 'dist'` (defaulted but stated explicitly so Turborepo's
  `outputs: ["dist/**"]` cache rule and the `package.json` `exports`
  map agree without ambiguity). The `dts` option is itself an object
  with `compilerOptions` overriding `composite`, `incremental`, and
  `ignoreDeprecations` only for the dts pass: tsup's internal
  declaration emit cannot share the workspace's composite/incremental
  flags (the former would force a separate `.tsbuildinfo` write, the
  latter would surface as a TS 6 deprecation error against the
  `baseUrl` value tsup injects), so the override keeps those two
  concerns scoped to the dts pass without leaking into the rest of the
  workspace's `tsc -b` graph. An esbuild `target` is intentionally
  not set at the tsup level — tsup picks up `target: "ES2023"` from
  `tsconfig.base.json` automatically (visible as `CLI Target: es2023`
  in the build log), which is the correct downlevel target for the
  Node 24 LTS runtime declared in `engines`. A separate
  `target: "node24"` override would be redundant. The current tsup
  8.5.x build emits a benign duplicate `//# sourceMappingURL=`
  directive at the end of `dist/index.js` (last-wins per V8 / Chrome
  / Node source-map resolver behaviour, functionally a no-op);
  tracked for cleanup against tsup upstream as a separate follow-up
  before the first observability artifact ingests these source maps
  in v0.5+.

  `packages/core/src/index.ts` re-exports `z` from `zod` so every
  Sovri workspace member (`@sovri/review-engine`, `@sovri/config`,
  `@sovri/llm-providers`, `@sovri/observability`, the bot, and the
  Cloud API once it exists) binds to the same Zod instance — this
  removes a class of subtle bugs in which two copies of Zod treat
  identically-shaped schemas as structurally unequal. The file is
  otherwise empty: domain-specific types and schemas land in
  subsequent issues against this package. The Apache 2.0 SPDX header
  appears on lines 1-2 per the universal rule in
  `docs/adr/010-licence-apache-2.md`.

  `packages/core/src/index.test.ts` is a single Vitest assertion that
  the re-exported `z` is a functional Zod instance — it checks the
  identity of the namespace (`typeof z === "object"`) and the
  callability of `z.string` (`typeof z.string === "function"`). The
  test verifies the package's wiring without re-testing Zod's own
  validation contract (that is owned upstream); it will grow into
  real coverage when the first domain schema lands in a subsequent
  issue.

  `packages/core/README.md` documents the scope ("types and Zod
  schemas only — zero I/O"), explains the workspace-relative script
  invocation convention (`pnpm --filter @sovri/core <script>` rather
  than direct `cd && tsc`), and links back to the public sources of
  truth: `ARCHI.md` §4.1, `docs/adr/005-zod-runtime-validation.md`,
  `docs/adr/008-tsup-bundler.md`, and
  `docs/adr/010-licence-apache-2.md`.

  Dependencies: the package's `devDependencies` block carries
  `tsup@8.5.1` (build) and `vitest@4.1.6` (test runner — vitest is
  imported by `index.test.ts` source, so it must be declared directly
  in the package, not relied on via root hoisting since `.npmrc` does
  not set `node-linker=hoisted`). The `dependencies` block carries
  `zod@4.4.3` as the only runtime dep — matching the issue #16
  acceptance criterion "no runtime dep except zod" and
  `docs/adr/005-zod-runtime-validation.md` which establishes Zod as
  the single runtime validation library. All three additions were
  performed via `pnpm add --filter @sovri/core` (the only channel the
  `no-manual-deps.sh` pre-commit hook from #14 accepts), with
  `.npmrc save-exact=true` enforcing the exact pin (no `^` / `~`
  range operators) that ADR-005 and ADR-008 require for SDK-class
  dependencies in the post-mini-shai-hulud threat model.

  `typescript` is intentionally not added as a per-package devDep:
  the package's `typecheck` script invokes `tsc` via `pnpm exec`,
  which walks the workspace symlink tree and resolves to the single
  root `typescript@6.0.3` entry. Adding a per-package copy would
  invite version drift that `pnpm dedupe --check` (a pre-push gate)
  flags as a duplicate, and the binary-only usage does not require
  resolvable imports the way `vitest` and `tsup` do. The same logic
  applies to `oxlint` and `oxfmt`. The convention is documented in
  the package README so future contributors do not invoke
  `cd packages/core && tsc` directly and get confused by the
  resolution failure.

  Acceptance criteria coverage: AC1 (`pnpm --filter @sovri/core
  build` produces `dist/index.js` + `dist/index.d.ts`) is satisfied
  by the tsup config + scripts wiring described above; AC2 (no
  runtime dep except `zod`) is satisfied by the `dependencies` block
  containing only `zod@4.4.3`; AC3 (no fs/network/env access in
  source) is satisfied by the re-export-only `src/index.ts` plus the
  pure-domain policy stated in the package README — enforced going
  forward by code review against any future PR that introduces a
  Node built-in import into this package.

  Walking-skeleton invariants from #15 still hold after this PR:
  `pnpm turbo build --filter='./packages/*'` now resolves to a
  non-empty filter set and executes a real `tsup` build that
  completes in well under a second; `pnpm exec vitest run
  --passWithNoTests` runs one passing test instead of no-opping;
  `pnpm exec tsc -b` walks the new project reference graph and emits
  a `.tsbuildinfo` for `packages/core`; `pnpm exec knip --reporter
  compact` reports zero unused exports/files/deps against the new
  package; and `pnpm dedupe --check` + `pnpm audit
  --audit-level=high --ignore-registry-errors` continue to pass
  against the expanded lockfile.

- Placeholder `packages/README.md` (#15) — creates an empty `packages/`
  directory at the repo root so the pre-push `build` command (`pnpm
  turbo build --filter='./packages/*'`) resolves its filter to an
  empty package set and exits `0` in the walking-skeleton state.
  Without the placeholder, `turbo` aborts with `Directory ... specified
  in filter does not exist` and blocks every push, which would
  contradict the v0.1 onboarding promise that `git push` works on a
  fresh clone. The README form (rather than a zero-byte `.gitkeep`)
  was chosen because `.claude/rules/30-licensing.md:17` requires an
  Apache 2.0 header on every file under `packages/**`, and an empty
  placeholder cannot carry one without defeating its purpose; the
  README carries the SPDX header and doubles as documentation of the
  workspace's intended membership. Each subsequent package init task
  (#21, #24, #27, #31) lands its own `package.json` under this
  directory and registers as a workspace member via the `packages/*`
  glob in `pnpm-workspace.yaml`; the README is removed in the PR that
  introduces the first real workspace member.
- `lefthook.yml` pre-push wiring (#15) — resolves the deferral noted in
  the #14 entry below by adding the `pre-push` block specified in
  `ARCHI.md` §16.1 verbatim. Pre-push declares six commands running in
  parallel — `ts-test` (`pnpm exec vitest run --passWithNoTests
  --reporter=default`), `ts-typecheck` (`pnpm exec tsc -b` — full project
  build, not the `--noEmit` variant used by the same-named pre-commit
  command), `audit` (`pnpm audit --audit-level=high
  --ignore-registry-errors`), `dedupe` (`pnpm
  dedupe --check`), `knip` (`pnpm exec knip --reporter compact`), and
  `build` (`pnpm turbo build --filter='./packages/*'`) — each carrying
  an actionable `fail_text` pointing at the exact recovery command. No
  `skip:` or `glob:` constraints are set on any pre-push command: they
  must run on every push regardless of branch, worktree state, or merge
  origin (a push is a deliberate publish event, unlike a commit which
  can be intermediate). The block mirrors the heavier CI gates declared
  in `ARCHI.md` §15.3 (`backend-checks` → `ts-test` + `ts-typecheck` +
  `build`, `knip` → `knip`, `supply-chain` → `audit` + `dedupe`).
  ADR-012's reciprocity rule (lines 54-56, *"Every rule rejected by CI
  also has a local hook in `lefthook.yml`. Every local hook also has a
  CI counterpart. New rules are added to **both layers simultaneously**;
  a future ADR or amendment is required if a rule deliberately exists
  in one layer only."*) is technically suspended for the window between
  this PR and the CI counterparts landing in #48 (`backend-checks`),
  #49 (`knip` + `supply-chain`), #50–#56 (the remaining workflows): the
  local layer is wired here, the CI layer is tracked by those open
  issues, and the temporary one-layer-only state is logged via the
  Exception procedure documented at ADR-012 lines 58-60 (maintainer-
  approved exception, follow-up issues already filed, walking-skeleton
  phase only). No ADR amendment is required because the gap is
  scheduled, not deliberate — the reciprocity guarantee is restored as
  soon as #48–#49 (the gates that this PR's hooks mirror) merge. The
  `pnpm exec vitest run` form depends on `vitest` being resolvable from
  the root workspace, so this PR also adds `vitest@4.1.6` as a root
  `devDependency` via `pnpm add -D -w vitest` (the only allowed channel
  — manual `package.json` edits are blocked by the `no-manual-deps`
  pre-commit hook from #14, and `.npmrc save-exact=true` plus
  `.claude/rules/20-security.md` together enforce an exact pin without
  the `^` / `~` range operators on every devDep including this one),
  pinning ADR-007's Vitest 4 + MSW 2 stack to its first concrete
  dependency. MSW remains out of scope until the first integration test
  lands. ADR-012's
  expected pre-push duration (30–90 s) is preserved: vitest no-ops on
  zero discovered tests thanks to `--passWithNoTests`, `tsc -b` is a
  no-op until the first package's `tsconfig.json` is added to the root
  references list, `pnpm audit` and `pnpm dedupe --check` are fast
  metadata reads against the locked tree, `knip` against an empty
  workspace returns in well under a second, and `pnpm turbo build
  --filter='./packages/*'` no-ops with the empty filter set until
  `packages/` is populated. The `audit` command carries the
  `--ignore-registry-errors` flag (added as a refinement of the
  `ARCHI.md` §16.1 verbatim spec after a PR review caught the gap):
  without it, a transient npm advisory registry outage would propagate
  as a hard non-zero exit and block every contributor's `git push` for
  the duration of the outage, even with a perfectly clean lockfile.
  The pnpm CLI documents the flag as "use exit code 0 if the registry
  responds with an error" so vulnerability findings still surface as
  blocking exits while infrastructure failures degrade gracefully. The
  same flag is applied to the matching CI `supply-chain` job spec in
  `ARCHI.md` §15.3 so the reciprocity rule is preserved when #49
  lands. The deferral wording from the #14 entry no longer reflects
  the repo state once this PR lands; the historical text is kept
  intact below so the [Unreleased] log reads as a truthful sequence of
  intent → resolution rather than retroactive rewriting.
- Smoke test extension `scripts/lefthook.test.sh` (#15) — replaces the
  Section 10 assertion that the `pre-push` block is absent (which #14
  introduced specifically so accidental partial wiring would trip the
  test) with three new sections targeting issue #15 acceptance
  criteria. Section 10 now asserts the declared shape of the pre-push
  block end to end: the `pre-push:` block is present, `parallel: true`
  is scoped to that block (re-using the awk window pattern that scopes
  Section 4 to the pre-commit block so a future `commit-msg` /
  `post-merge` hook cannot poison the assertion), the six required
  commands (`ts-test`, `ts-typecheck`, `audit`, `dedupe`, `knip`,
  `build`) are present at the correct indentation, every pre-push
  command carries a `fail_text` field, and each command's `run:` line
  matches the exact string from `ARCHI.md` §16.1 (drift here means
  spec divergence and trips the test — for example, `pnpm exec tsc -b`
  on pre-push is distinct from the pre-commit `pnpm exec tsc -b
  --noEmit` because the pre-push variant must catch missing build
  artifacts that `--noEmit` skips, and the scoped grep prevents the
  look-alike substring from satisfying the wrong block). Section 11
  exercises issue #15 AC2 functionally: a `.lefthook-test-failing.test.ts`
  fixture written into the repo root (dot-prefixed to stay outside
  source globs, removed on every script invocation regardless of
  outcome) declares a failing `expect(1).toBe(2)`, the exact
  `pnpm exec vitest run --passWithNoTests --reporter=default <file>`
  form from the spec is invoked against it, and the test passes only
  when the binary exits non-zero with a `FAIL` token in its output —
  this confirms that the lefthook command propagates a failing test
  as a blocking exit code rather than masking it. Section 12 covers
  AC3 via the inverse path: `pnpm dedupe --check` is invoked against
  the live workspace and must exit `0` in the healthy state, proving
  the binary is resolvable, the lockfile is well-formed, and no
  dedupe drift snuck into the PR diff; the negative path (duplicates
  present → non-zero exit) is owned by the upstream `pnpm dedupe
  --check` contract referenced verbatim by §16.1 and is too expensive
  to synthesise inside a smoke test (it would require a real
  `pnpm install` loop against a mktemp workspace with two
  intentionally divergent version constraints, multiplying script
  runtime by an order of magnitude). The exit-code convention is
  preserved (`0` pass, `1` policy / spec deviation, `2` infra error
  such as missing vitest binary), and the existing AC2 / AC3 cases
  from #14 (`typescript/no-explicit-any` direct check and the inline
  `changelog-updated` replay across three sub-cases) remain unchanged.
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

- `@sovri/core` exports `SeveritySchema`, `CategorySchema`, and `FindingSchema`
  Zod schemas plus their inferred TypeScript types (`Severity`, `Category`,
  `Finding`) (#17), implementing the pure-domain Finding shape described in
  `ARCHI.md` §6.1. The schemas live in `packages/core/src/types/Finding.ts`
  and are re-exported from the package barrel `packages/core/src/index.ts`.
  `SeveritySchema` is a five-value enum (`blocker | major | minor | info |
  nitpick`) ordered by impact; `CategorySchema` is a seven-value taxonomy
  (`bug | security | performance | maintainability | style | documentation |
  test-coverage`); `FindingSchema` validates the structured review output
  shared between LLM-derived and SARIF-ingested findings — `id` is a UUID
  (Zod 4 `z.uuid()` format, replacing the now-deprecated `z.string().uuid()`
  chain shown verbatim in the ARCHI sample), `file` is a non-empty string,
  `line_start`/`line_end` are positive integers, `title` is bounded at
  1..200 characters, `body` at 1..2000, `source` is the `"llm" | "sarif"`
  origin enum, `confidence` is a 0..1 inclusive float, and the optional
  `suggestion` (`{ code, committable }`) and `cwe` (`/^CWE-\d+$/`) fields
  cover patch suggestions and SARIF-security cross-references respectively.
  Both `z.infer<typeof FindingSchema>` (the exported `Finding` type) and the
  hand-written field shape are kept in sync by deriving the type from the
  schema rather than declaring them independently, per the ADR-005 "Zod is
  the runtime source of truth" rule. The accompanying
  `packages/core/src/types/Finding.test.ts` file ships 77 Vitest cases that
  cover each enum value end-to-end, every length and range boundary
  (inclusive accept + 1-off reject), the optional/absent code paths for
  `suggestion` and `cwe`, the regex anchoring of CWE identifiers (rejecting
  lowercase prefixes, missing digits, and trailing garbage), each required
  field omission, and the type-inference round-trip (`Finding` → parse →
  equal). Coverage on `Finding.ts` is 100 % statements / 100 % lines /
  100 % branches (the file declares only top-level schema constants, so
  Istanbul counts 5/5 statements and 0/0 branches), satisfying issue #17's
  acceptance criterion. The infrastructure change required to surface that
  number — adding `@vitest/coverage-v8@4.1.6` and
  `@vitest/coverage-istanbul@4.1.6` as workspace devDependencies pinned to
  the same exact version as the `vitest@4.1.6` already at the root, so the
  three packages share a single peer-dependency identity and `pnpm
  --filter @sovri/core exec vitest run --coverage` resolves without a
  `MISSING DEPENDENCY` failure — is covered in this same entry rather than
  carved out separately because it has no value outside the schema test
  suite it unblocks.

- `@sovri/core` exports `ReviewSchema` and its inferred `Review` type (#18),
  implementing the top-level review aggregate described for the v0.1 walking
  skeleton. The schema lives in `packages/core/src/types/Review.ts` and is
  re-exported from `packages/core/src/index.ts`, keeping the package barrel as
  the single public entry point for core contracts. It validates review
  provenance (`id`, `pr_number`, `repo_full_name`, `commit_sha`), timing
  (`started_at`, `completed_at`), LLM metadata, token counts, summary,
  findings, walkthrough markdown, status, and optional error text. Repository
  names must use a bounded `owner/repo` shape, commit SHAs are constrained to
  40 lowercase hexadecimal characters, token counts must be non-negative
  integers, status is limited to `success | partial | failed`, and
  `started_at` must be earlier than or equal to `completed_at`; the date-order
  rule resolves the issue's open acceptance-criteria question by enforcing the
  only chronologically valid review lifecycle at schema level. The accompanying
  `packages/core/src/types/Review.test.ts` suite covers valid reviews, optional
  errors, zero-token boundaries, bad commit SHA lengths and characters, invalid
  repository names, invalid temporal ordering, invalid token counts, invalid
  statuses, required field omissions, and the `Review` type-inference
  round-trip. `packages/core/src/index.test.ts` also asserts the barrel export
  so downstream packages can rely on `@sovri/core` rather than importing
  internal type files directly.

- `@sovri/core` exports `PullRequestSchema`, `DiffSchema`, `FileChangeSchema`,
  and `FileChangeStatusSchema` Zod schemas plus their inferred TypeScript types
  (`PullRequest`, `Diff`, `FileChange`, `FileChangeStatus`) (#19), implementing
  the input-side domain types referenced by `ARCHI.md` §4.1 and §5.5. The
  schemas live in `packages/core/src/types/PullRequest.ts` and are re-exported
  from the package barrel `packages/core/src/index.ts`. `PullRequestSchema`
  captures the metadata the review engine needs from a Probot pull-request
  payload — `number` (positive integer), `repo_full_name` (bounded
  `owner/repo` shape, same regex as `ReviewSchema`), `head_sha` and `base_sha`
  (40 lowercase hex characters, same regex as `ReviewSchema.commit_sha`),
  `head_ref` and `base_ref` (non-empty strings), `author` (non-empty
  `user.login`), `draft` (boolean), `title` (non-empty), `body` (string or
  `null` for description-less PRs), and `additions` / `deletions` /
  `changed_files` (non-negative integers). `FileChangeStatusSchema` is the
  normalised four-value enum `added | modified | removed | renamed` —
  GitHub's wider `copied | changed | unchanged` extras collapse upstream of
  `@sovri/core` so the domain layer reasons about the four canonical cases
  only; the schema carries a leading comment that documents this
  pre-condition so a caller passing a raw Octokit payload fails loudly at
  the parse boundary instead of silently mis-categorising the file.
  `FileChangeSchema` validates a per-file diff entry — `path`
  (non-empty), `previous_path` (optional, non-empty), `status`, `additions`
  / `deletions` (non-negative integers), `sha` (40 lowercase hex), `patch`
  (string, including empty, or `null` for binary/oversized files), and
  `hunks` (array of structured hunks with `old_start` / `old_lines` /
  `new_start` / `new_lines` non-negative integers, non-empty `header`, and
  raw `lines: string[]`). A `superRefine` enforces the cross-field invariant
  that `previous_path` is required and must differ from `path` when
  `status === "renamed"`, and rejected entirely on the other three statuses
  — three error paths the field-level optional alone cannot express.
  `DiffSchema` wraps the raw `unified_diff` blob alongside the array of
  parsed `FileChangeSchema` entries so review-engine callers can pass both
  the textual form (for prompt assembly) and the structured form (for inline
  comment anchoring) through one validated boundary. The private
  `HunkSchema` is deliberately not exported — its parser lives outside
  `@sovri/core`, and keeping it internal preserves the option to evolve the
  parsed hunk shape without breaking the public surface. The accompanying
  `packages/core/src/types/PullRequest.test.ts` file covers each schema's
  happy paths, every boundary on each `sha` / `repo_full_name` / numeric
  field, all four enum values plus rejections of `copied` / `changed` /
  `unchanged` / non-string / empty inputs, the `null` / `undefined` /
  numeric `patch` and `body` cases, hunk-level integer-range and
  non-string-line rejections, every required-field omission across the four
  exported schemas, the three `previous_path` / `status` `superRefine`
  branches (renamed without `previous_path`, renamed with
  `previous_path === path`, non-renamed with `previous_path`), and the
  type-inference round-trip for `PullRequest`, `Diff`, `FileChange`, and
  `FileChangeStatus`. `packages/core/src/index.test.ts` is extended in the
  same PR to assert each of the four new schemas resolves through the
  package barrel.

### Changed

- Tighten the workspace `engines.node` floor from `>=24.0.0 <25.0.0` to
  `>=24.8.0 <25.0.0` (#20). The new `applyIgnoreRules` helper relies on
  `path.posix.matchesGlob`, which the Node maintainers only marked stable
  in v24.8.0 / v22.20.0 (still experimental on 24.0–24.7.x). Bumping the
  floor avoids the experimental-API warning on officially supported
  runtimes and keeps the package contract honest. The matching bump
  lands in both the workspace root `package.json` and
  `packages/core/package.json` so `engine-strict=true` in `.npmrc`
  refuses to install under a pre-stable Node 24.

- `feat(config)`: widen `LlmSchema.provider` `.refine()` from the v0.1
  single-value `value === "anthropic"` to the v0.2 allow-list
  `value === "anthropic" || value === "mistral"`. Rejection message
  becomes `Only 'anthropic' and 'mistral' are enabled in this release.`.
  `ProviderSchema` enum stays unchanged (wide enum, narrow refine —
  ADR-005). Stale v0.1 assertions in `SovriConfig.test.ts` and
  `loader.test.ts` (plus the `schema-violation-bad-provider` fixture)
  flip from `mistral` to `openai` to keep the refine-rejection coverage
  intact (R-01 nominal, ATDD scenario sub-issue #1164 under US #1162).

### Deprecated

### Removed

- Placeholder `packages/README.md` (#16) — closes the loop opened by the
  same file's #15 introduction. The placeholder explicitly committed to
  being deleted "in the PR that introduces the first real workspace
  member" (its line 23 verbatim), and #16's `@sovri/core` scaffold is
  that member. The deletion is safe because the conditions that made
  the placeholder necessary in #15 no longer hold: `pnpm turbo build
  --filter='./packages/*'` now resolves its filter to `@sovri/core`
  rather than the empty set, so the "Directory ... specified in filter
  does not exist" abort path is no longer reachable; the universal
  Apache 2.0 header rule from `docs/adr/010-licence-apache-2.md` is
  now satisfied by the per-file SPDX headers on every `.ts` source in
  `packages/core/` and the HTML-comment header in
  `packages/core/README.md`; and the `packages/` directory remains
  tracked by `git` because it now contains real source files rather
  than relying on a marker file. Subsequent package init tasks (#21
  `observability`, #24 `config`, #27 `llm-providers`, #31
  `review-engine`) add their own `package.json` under this directory
  and join the workspace via the unchanged `packages/*` glob in
  `pnpm-workspace.yaml`.

### Fixed

- `@sovri/observability`: `NODE_ENV` is now compared case-insensitively against `"production"` so mixed-case values disable the pretty transport, and `pino-pretty` resolvability is probed before enabling the transport so production-pruned installs fall back to JSON instead of crashing the worker. (#85)

- `knip.json` now treats `lefthook` as an intentional root tooling dependency,
  matching the hook-manager policy documented in `docs/adr/012-lefthook-ci-gates.md`
  and preventing the pre-push `knip` gate from flagging the hook binary as
  unused.

### Security

- `@sovri/observability`: Pino `redact` option strips GitHub tokens, LLM API keys, webhook secrets, GitHub App private keys, and authorization headers from every log record (top-level + nested + wildcard one-level paths). Censor is the literal `[Redacted]`. Child loggers inherit the policy. Path source of truth: `REDACT_PATHS` in `packages/observability/src/logger.ts`. Closes #23. (`ARCHI.md` §9.2, CLAUDE.md NEVER rule on token logging.)

- Enforced a 7-day cooldown before any Dependabot version-update pull
  request is opened (#6), mitigating the supply-chain timing window for
  compromised packages highlighted by the May 2026 mini-shai-hulud
  incident (TanStack, Mistral SDK and OpenSearch compromised). Note that
  Dependabot security-update PRs bypass cooldown by design; merge-time
  review remains enforced by branch protection and human approval.

---

## [0.1.0]

### Security

- Cosign signing is deferred to v0.5.

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
