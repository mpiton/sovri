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

### Fixed

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

## Release procedure

1. Move all entries from `[Unreleased]` into a new `## [vX.Y.Z] — YYYY-MM-DD`
   section. Keep an empty `[Unreleased]` section at the top with the six
   category headings for the next development cycle.
2. Verify that the version in every `packages/*/package.json` and
   `apps/community-bot/package.json` matches `vX.Y.Z`.
3. Tag the release: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push --tags`.
   The `release.yml` workflow takes over from there (build, sign, publish to
   GHCR and npm, attach SBOM and SLSA attestation).
