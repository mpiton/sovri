#!/usr/bin/env bash
# Acceptance tests for the self-host observability guide (task-134, R-01..R-10).
#
# task-134 is a docs-only deliverable: docs/observability.md + one README "Documentation" row + one
# CHANGELOG entry, no .ts/.mjs source touched (so tsc/oxlint/oxfmt/vitest stay green untouched). The
# acceptance is therefore self-contained: this script carries its own `eval_docs` validator (the
# executable encoding of R-01..R-10) and exercises it two ways — synthetic fixtures prove the
# validator accepts a correct guide and rejects each single defect, and a final @technical case runs
# it against the REAL docs/observability.md + README.md + CHANGELOG.md. The context.md @e2e default
# refers to the operator-side commands the guide hands a self-hoster (curl the live /metrics, cosign
# verify a pushed GHCR digest, gh attestation verify) — those need a real deployed bot + GHCR push +
# GitHub OIDC and cannot run in the suite, so the runnable acceptance is this static check. Mirrors the
# self-contained policy-test precedent of task-132/133.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REAL_DOC="$ROOT/docs/observability.md"
REAL_README="$ROOT/README.md"
REAL_CHANGELOG="$ROOT/CHANGELOG.md"
PASS=0
FAIL=0
FAILURES=""

record_failure() {
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  x ${1}: ${2}"
}

# ==================================================================================================
# eval_docs — the validator. Reads --doc / --readme / --changelog, prints one `key=value` marker per
# rule, and returns 0 only when every rule passes (else 1, with `docs_observability=fail`). This is the
# single source of truth for R-01..R-10; GREEN makes the real docs satisfy it.
# ==================================================================================================
eval_docs() {
  local doc="" readme="" changelog=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --doc) doc="$2"; shift 2 ;;
      --readme) readme="$2"; shift 2 ;;
      --changelog) changelog="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  local failed=0
  mark_fail() { failed=1; }

  # R-01 — the guide file must exist at all (RED baseline).
  if [ ! -f "$doc" ]; then
    printf 'docs_observability=fail\nguide=missing\n'
    return 1
  fi

  # R-01 — four separately headed areas.
  local area_fail=0
  grep -qE '^## OpenTelemetry stacks\b' "$doc" || { printf 'missing_area=otel-stacks\n'; area_fail=1; }
  grep -qE '^## Environment variables\b' "$doc" || { printf 'missing_area=env-vars\n'; area_fail=1; }
  grep -qE '^## Metrics endpoint\b' "$doc" || { printf 'missing_area=metrics-endpoint\n'; area_fail=1; }
  grep -qE '^## Verify the image before you deploy\b' "$doc" || { printf 'missing_area=image-verification\n'; area_fail=1; }
  if [ "$area_fail" -eq 1 ]; then printf 'sections=incomplete\n'; mark_fail; else printf 'sections=complete\n'; fi

  # R-01 — three recommended OTel stacks.
  if grep -q 'Grafana Cloud' "$doc" && grep -q 'Tempo' "$doc" && grep -q 'SigNoz' "$doc"; then
    printf 'otel_stacks=three\n'
  else
    printf 'otel_stacks=insufficient\n'; mark_fail
  fi

  # R-02 — explicit no-op default contract.
  if grep -q 'OTEL_EXPORTER_OTLP_ENDPOINT' "$doc" && grep -qi 'unset' "$doc" \
     && grep -q 'createLogger' "$doc" && grep -qiE 'no telemetry|emits no telemetry' "$doc"; then
    printf 'noop_contract=stated\n'
  else
    printf 'noop_contract=missing\n'; mark_fail
  fi

  # R-02 — the three OTEL_* variables and their defaults.
  if grep -q 'OTEL_EXPORTER_OTLP_ENDPOINT' "$doc" && grep -q 'OTEL_SERVICE_NAME' "$doc" \
     && grep -q 'OTEL_SERVICE_VERSION' "$doc" && grep -q 'sovri-community-bot' "$doc" \
     && grep -q '0.0.0' "$doc"; then
    printf 'env_vars=documented\n'
  else
    printf 'env_vars=missing\n'; mark_fail
  fi

  # R-04 — the five sovri.* metrics with exact type + tag keys.
  local metrics_ok=1
  check_metric() {
    local name="$1" type="$2"; shift 2
    local row
    row=$(grep -F "\`${name}\`" "$doc" | head -1)
    if [ -z "$row" ] || ! printf '%s' "$row" | grep -qw "$type"; then
      printf 'metric=%s\n' "$name"; metrics_ok=0; return
    fi
    local tag
    for tag in "$@"; do
      if ! printf '%s' "$row" | grep -qF "\`${tag}\`"; then printf 'metric=%s\n' "$name"; metrics_ok=0; return; fi
    done
  }
  check_metric 'sovri.reviews.total' counter status llm_provider
  check_metric 'sovri.reviews.duration_ms' histogram llm_provider
  check_metric 'sovri.findings.total' counter severity category source
  check_metric 'sovri.llm.tokens' counter provider model direction
  check_metric 'sovri.llm.errors' counter provider error_type
  if [ "$metrics_ok" -eq 1 ]; then printf 'metrics=exact\n'; else printf 'metrics=mismatch\n'; mark_fail; fi

  # R-04 — the five review.* spans (no more, no fewer) plus the root attributes.
  local spans_ok=1 span
  for span in review.pull_request review.fetch_diff review.build_prompt review.llm_call review.parse_findings; do
    grep -qF "$span" "$doc" || { printf 'span=%s\n' "$span"; spans_ok=0; }
  done
  local attr
  for attr in pr.number pr.repo llm.provider findings.count; do
    grep -qF "$attr" "$doc" || spans_ok=0
  done
  local extra
  extra=$(grep -oE 'review\.[a-z_]+' "$doc" | sort -u \
    | grep -vE '^review\.(pull_request|fetch_diff|build_prompt|llm_call|parse_findings)$' | head -1)
  if [ -n "$extra" ]; then printf 'span=%s\n' "$extra"; spans_ok=0; fi
  if [ "$spans_ok" -eq 1 ]; then printf 'spans=exact\n'; else printf 'spans=mismatch\n'; mark_fail; fi

  # R-04 — the redaction note.
  if grep -qiE 'never carry a github token|never carry.*token.*key.*payload' "$doc"; then
    printf 'redaction_note=present\n'
  else
    printf 'redaction_note=missing\n'; mark_fail
  fi

  # R-03 — the /metrics endpoint example uses the shipped port and path.
  if grep -qF 'curl http://localhost:3000/metrics' "$doc" && grep -qF 'metrics_path: /metrics' "$doc"; then
    printf 'metrics_url=consistent\n'
  else
    printf 'metrics_url=inconsistent\n'; mark_fail
  fi

  # R-03 — verify commands consistent with the release workflow (image ref, OIDC issuer, tag scheme).
  local cmd_ok=1 reason=""
  if grep -qE 'cosign verify|gh attestation verify' "$doc"; then
    # Image ref: every community-bot reference is the official repo.
    if grep -oE 'ghcr\.io/[A-Za-z0-9._/-]*community-bot' "$doc" | grep -qv '^ghcr\.io/mpiton/sovri/community-bot$'; then
      reason="image_ref"; cmd_ok=0
    fi
    # OIDC issuer: the canonical GitHub Actions OIDC issuer only.
    if [ "$cmd_ok" -eq 1 ] && grep -qE -- '--certificate-oidc-issuer' "$doc" \
       && ! grep -qF -- '--certificate-oidc-issuer https://token.actions.githubusercontent.com' "$doc"; then
      reason="oidc_issuer"; cmd_ok=0
    fi
    # Tag scheme: image tags are v-prefixed SemVer (or `latest`); reject off-scheme tags like :dev.
    if [ "$cmd_ok" -eq 1 ]; then
      local tag
      while IFS= read -r tag; do
        case "$tag" in
          v[0-9]*|latest) ;;
          "") ;;
          *) reason="tag_scheme"; cmd_ok=0 ;;
        esac
      done < <(grep -oE 'community-bot:[A-Za-z0-9._-]+' "$doc" | sed 's/^community-bot://')
    fi
  fi
  if [ "$cmd_ok" -eq 1 ]; then printf 'commands=consistent\n'; else printf 'commands=inconsistent\nreason=%s\n' "$reason"; mark_fail; fi

  # R-05 — verification framed before deploy.
  if grep -qiE 'verify it afterwards|after you deploy|once it is running|deploy the image first' "$doc"; then
    printf 'verify=not_pre_deploy\n'; mark_fail
  else
    printf 'verify=pre_deploy\n'
  fi

  # R-06 — only public versioned references; no internal-only path.
  local leak
  leak=$(grep -oE '(PRD\.md|ARCHI\.md|CLAUDE\.md|specs/[^ )]+|\.claude/[^ )]+)' "$doc" | head -1)
  if [ -n "$leak" ]; then printf 'references=internal_leak\npath=%s\n' "$leak"; mark_fail; else printf 'references=public\n'; fi

  # R-07 — within v0.6 scope.
  if grep -qi 'SARIF' "$doc"; then printf 'scope=out_of_bounds\nterm=sarif\n'; mark_fail
  elif grep -qi 'dashboard' "$doc"; then printf 'scope=out_of_bounds\nterm=dashboard\n'; mark_fail
  elif grep -qiE 'cloud[- ]edition|managed telemetry' "$doc"; then printf 'scope=out_of_bounds\nterm=cloud\n'; mark_fail
  else printf 'scope=in_bounds\n'; fi

  # R-08 — README Documentation table links the guide exactly once and the link resolves.
  local count
  count=$(grep -cF '](docs/observability.md)' "$readme")
  if [ "$count" -eq 0 ]; then printf 'readme_row=missing\n'; mark_fail
  elif [ "$count" -ge 2 ]; then printf 'readme_row=duplicate\n'; mark_fail
  elif [ -f "$(dirname "$readme")/docs/observability.md" ]; then printf 'readme_row=present\n'
  else printf 'readme_row=unresolved\n'; mark_fail
  fi

  # R-09 — CHANGELOG [Unreleased] has a docs-scoped Added entry naming the guide.
  # Here-strings, not `printf | grep -q`: under `set -o pipefail` a `grep -q` that exits early on a
  # large [Unreleased] block SIGPIPEs the upstream printf and the pipeline reports failure even on a
  # match (false negative). A here-string has no upstream writer to kill.
  local unrel
  unrel=$(awk '/## \[Unreleased\]/{f=1;next} /^## /{f=0} f' "$changelog")
  if grep -qiF 'observability' <<<"$unrel" && grep -qF '`docs`' <<<"$unrel"; then
    printf 'changelog=recorded\n'
  else
    printf 'changelog=missing\n'; mark_fail
  fi

  # R-10 — ASCII, straight quotes, sentence-case headings.
  if grep -qP '[\x{2018}\x{2019}\x{201C}\x{201D}]' "$doc"; then printf 'markdown=dirty\nreason=curly_quotes\n'; mark_fail
  elif grep -qP '[^\x00-\x7F]' "$doc"; then printf 'markdown=dirty\nreason=non_ascii\n'; mark_fail
  elif awk '/^#/{h=$0; sub(/^#+[ ]*/,"",h); n=split(h,w," "); c=0; for(i=1;i<=n;i++) if(w[i] ~ /^[A-Z]/) c++; if(c>=3){found=1}} END{exit found?0:1}' "$doc"; then
    printf 'markdown=dirty\nreason=title_case\n'; mark_fail
  else
    printf 'markdown=clean\n'
  fi

  # R-10 — no real-looking credential. (These grep patterns carry a `[` right after the prefix, so the
  # repo's own no-secrets scanner does not flag this very line.)
  if grep -qE -e 'ghp_[A-Za-z0-9]{36}' -e 'sk-ant-[A-Za-z0-9_-]{20,}' -e 'sk-[A-Za-z0-9_-]{32,}' \
       -e 'AKIA[0-9A-Z]{16}' -e 'AIza[0-9A-Za-z_-]{35}' "$doc"; then
    printf 'secret_leak=detected\n'; mark_fail
  else
    printf 'secrets=placeholders_only\n'
  fi

  if [ "$failed" -eq 1 ]; then printf 'docs_observability=fail\n'; return 1; fi
  printf 'docs_observability=pass\n'
  return 0
}

# Run eval_docs, assert exit 0 and that stdout contains every expected token.
assert_pass() {
  local name="$1"
  shift
  local -a expected=()
  while [ "$1" != "--" ]; do
    expected+=("$1")
    shift
  done
  shift
  local out ec
  out=$(eval_docs "$@" 2>&1)
  ec=$?
  if [ "$ec" -ne 0 ]; then
    record_failure "$name" "expected exit 0, got ${ec}: ${out}"
    return
  fi
  local token
  for token in "${expected[@]}"; do
    if ! printf '%s\n' "$out" | grep -Fq "$token"; then
      record_failure "$name" "missing stdout token '${token}' in: ${out}"
      return
    fi
  done
  PASS=$((PASS + 1))
}

# Run eval_docs, assert non-zero exit and that output contains every expected token.
assert_fail() {
  local name="$1"
  shift
  local -a expected=()
  while [ "$1" != "--" ]; do
    expected+=("$1")
    shift
  done
  shift
  local out ec
  out=$(eval_docs "$@" 2>&1)
  ec=$?
  if [ "$ec" -eq 0 ]; then
    record_failure "$name" "expected non-zero exit, got 0: ${out}"
    return
  fi
  local token
  for token in "${expected[@]}"; do
    if ! printf '%s\n' "$out" | grep -Fq "$token"; then
      record_failure "$name" "missing token '${token}' in: ${out}"
      return
    fi
  done
  PASS=$((PASS + 1))
}

# A complete, correct self-host observability guide. This fixture is the canonical shape the real
# docs/observability.md mirrors: four headed areas, three OTel stacks, the no-op contract, the three
# OTEL_* vars + defaults, the five sovri.* metrics with exact types/tags, the five review.* spans with
# the root attributes, the redaction note, the curl + Prometheus scrape, and the pre-deploy cosign +
# SLSA verification — public references only, ASCII with straight quotes and sentence-case headings.
good_doc() {
  cat <<'MARKDOWN'
# Self-host observability and image verification

This guide is for Community-edition self-host operators running the Sovri community-bot image. It
assumes the v0.6.0 (or newer) image. Every command below is copy-pasteable.

## OpenTelemetry stacks

Pick one OTLP-compatible backend and set its endpoint. These three setups are recommended.

- Grafana Cloud (hosted): set `OTEL_EXPORTER_OTLP_ENDPOINT` to your Grafana Cloud OTLP endpoint, for
  example `https://otlp-gateway-prod-eu-west-0.grafana.net/otlp`. Gives traces, logs, and metrics.
- Grafana + Tempo + Loki + Prometheus (self-hosted): set `OTEL_EXPORTER_OTLP_ENDPOINT` to your
  collector, e.g. `http://otel-collector:4318`. Tempo stores traces, Loki logs, Prometheus metrics.
- SigNoz (all-in-one): set `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://signoz-otel-collector:4318`.
  One install gives traces, logs, and metrics.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset) | OTLP collector URL. Leaving it unset disables telemetry. |
| `OTEL_SERVICE_NAME` | `sovri-community-bot` | Resource service name on every span and metric. |
| `OTEL_SERVICE_VERSION` | `0.0.0` | Resource service version. |

No-op default: with `OTEL_EXPORTER_OTLP_ENDPOINT` unset the bot starts normally and emits no telemetry,
and `createLogger()` behaves exactly as before.

## Metrics endpoint

The bot serves Prometheus text exposition at `GET /metrics` from the OpenTelemetry meter on port
3000. Scrape it directly:

```
curl http://localhost:3000/metrics
```

Point Prometheus at the same path:

```
scrape_configs:
  - job_name: sovri-community-bot
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:3000"]
```

### Business metrics

| Metric | Type | Tags |
| --- | --- | --- |
| `sovri.reviews.total` | counter | `status`, `llm_provider` |
| `sovri.reviews.duration_ms` | histogram | `llm_provider` |
| `sovri.findings.total` | counter | `severity`, `category`, `source` |
| `sovri.llm.tokens` | counter | `provider`, `model`, `direction` |
| `sovri.llm.errors` | counter | `provider`, `error_type` |

### Business spans

A review opens one root span `review.pull_request` with attributes `pr.number`, `pr.repo`,
`llm.provider`, and `findings.count`. It has four child spans: `review.fetch_diff`,
`review.build_prompt`, `review.llm_call`, and `review.parse_findings`.

What never leaves the bot: spans, metrics, and logs never carry a GitHub token, an LLM API key, or a
raw webhook payload.

## Verify the image before you deploy

Run these checks before you deploy: verify the released digest, then deploy that digest.

Keyless signature (cosign):

```
cosign verify ghcr.io/mpiton/sovri/community-bot:v0.6.0 \
  --certificate-identity-regexp '^https://github.com/mpiton/sovri/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

SLSA build provenance:

```
gh attestation verify oci://ghcr.io/mpiton/sovri/community-bot:v0.6.0 --owner mpiton
```

See docs/adr/019-otel-milestone-v0-6.md and docs/adr/006-pino-then-otel.md for the rationale, and
the root README.md for the published image tags.
MARKDOWN
}

good_readme() {
  cat <<'MARKDOWN'
# Sovri

## Documentation

| Resource | What you will find |
| --- | --- |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history. |
| [`docs/observability.md`](docs/observability.md) | Self-host OTel wiring, the /metrics endpoint, and image verification. |
| [`docs/sovri-yml-reference.md`](docs/sovri-yml-reference.md) | Config reference. |
MARKDOWN
}

good_changelog() {
  cat <<'MARKDOWN'
# Changelog

## [Unreleased]

### Added

- `docs`: self-host observability and image-verification guide (docs/observability.md).

## [0.5.0] - 2026-06-06

- Earlier work.
MARKDOWN
}

# Knobs read by run_case. MUT names a mutator applied to the good fixture after it is written; the
# mutator edits $DOC / $README / $CL in place to inject exactly one defect. reset_knobs clears them so
# nothing leaks between cases. Cases must NOT run in a subshell or PASS/FAIL counters would be lost.
reset_knobs() {
  unset MUT MUT_ARG README_KIND CHANGELOG_KIND GUIDE_MISSING
}

# --- mutators -------------------------------------------------------------------------------------
mut_omit_section() {
  perl -0pi -e "s/^## \\Q$MUT_ARG\\E\\b.*?(?=^## |\\z)//ms" "$DOC"
}
mut_stacks_two() {
  perl -0pi -e 's/- Grafana \+ Tempo.*?Prometheus metrics\.\n//s' "$DOC"
}
mut_noop_remove() {
  perl -0pi -e 's/No-op default:.*?behaves exactly as before\.\n//s' "$DOC"
}
mut_metric_drift() {
  case "$MUT_ARG" in
    sovri.reviews.total)
      perl -pi -e 's/^\| `sovri\.reviews\.total` \| counter \| `status`, `llm_provider` \|$/| `sovri.reviews.total` | histogram | `status` |/' "$DOC" ;;
    sovri.findings.total)
      perl -pi -e 's/^\| `sovri\.findings\.total` \| counter \| `severity`, `category`, `source` \|$/| `sovri.findings.total` | counter | `severity` |/' "$DOC" ;;
    sovri.llm.tokens)
      perl -pi -e 's/^\| `sovri\.llm\.tokens` \| counter \| `provider`, `model`, `direction` \|$/| `sovri.llm.tokens` | counter | `provider`, `model` |/' "$DOC" ;;
  esac
}
mut_span_extra() {
  printf '\nThe bot also opens `%s` after posting the review.\n' "$MUT_ARG" >>"$DOC"
}
mut_verify_image_ref() {
  perl -pi -e 's#ghcr\.io/mpiton/sovri/community-bot:v0\.6\.0#ghcr.io/acme/sovri/community-bot:v0.6.0#g' "$DOC"
}
mut_verify_oidc() {
  perl -pi -e 's#--certificate-oidc-issuer https://token\.actions\.githubusercontent\.com#--certificate-oidc-issuer https://example.com#' "$DOC"
}
mut_verify_tag_scheme() {
  perl -pi -e 's#community-bot:v0\.6\.0#community-bot:dev#g' "$DOC"
}
mut_verify_post_deploy() {
  perl -0pi -e 's/Run these checks before you deploy: verify the released digest, then deploy that digest\./Deploy the image first, then verify it afterwards once it is running./s' "$DOC"
}
mut_internal_path() {
  printf '\nSee %s for the internal rationale.\n' "$MUT_ARG" >>"$DOC"
}
mut_outscope() {
  case "$MUT_ARG" in
    sarif) printf '\nThe bot also ships a built-in SARIF ingester for third-party scanners.\n' >>"$DOC" ;;
    dashboard) printf '\nA hosted Sovri observability dashboard is available out of the box.\n' >>"$DOC" ;;
    cloud) printf '\nCloud-edition managed telemetry is included for self-hosters.\n' >>"$DOC" ;;
  esac
}
mut_markdown() {
  case "$MUT_ARG" in
    curly) perl -pi -e "s/--owner mpiton/--owner \xe2\x80\x9cmpiton\xe2\x80\x9d/" "$DOC" ;;
    nonascii) printf '\nDeploy on regulated infrastructure (caf\xc3\xa9-grade uptime).\n' >>"$DOC" ;;
    titlecase) printf '\n## A Title Case Section Heading\n\nBody.\n' >>"$DOC" ;;
  esac
}
mut_secret() {
  printf '\nExample token: %s\n' "$MUT_ARG" >>"$DOC"
}

run_case() {
  local name="$1"
  local mode="$2"
  shift 2
  local root
  root=$(mktemp -d)
  mkdir -p "$root/docs"
  DOC="$root/docs/observability.md"
  README="$root/README.md"
  CL="$root/CHANGELOG.md"
  export DOC README CL MUT_ARG

  good_doc >"$DOC"
  good_changelog >"$CL"

  # README variants.
  case "${README_KIND:-good}" in
    good) good_readme >"$README" ;;
    missing) good_readme | perl -ne 'print unless m{\Qdocs/observability.md\E}' >"$README" ;;
    duplicate)
      good_readme >"$README"
      perl -pi -e 's{^(\| \[`docs/observability\.md`\].*)$}{$1\n| [`docs/observability.md`](docs/observability.md) | Duplicate row. |}' "$README" ;;
    unresolved)
      good_readme >"$README"
      rm -f "$DOC"
      DOC="$root/observability.md"
      export DOC
      good_doc >"$DOC" ;;
  esac

  # CHANGELOG variants.
  if [ "${CHANGELOG_KIND:-good}" = missing ]; then
    perl -0pi -e 's/### Added\n\n- `docs`: self-host observability.*?\n//s' "$CL"
  fi

  # Guide-absent baseline.
  if [ "${GUIDE_MISSING:-}" = yes ]; then
    rm -f "$DOC"
  fi

  # Apply a doc mutator if requested.
  if [ -n "${MUT:-}" ]; then
    "$MUT"
  fi

  if [ "$mode" = pass ]; then
    assert_pass "$name" "$@" -- --doc "$DOC" --readme "$README" --changelog "$CL"
  else
    assert_fail "$name" "$@" -- --doc "$DOC" --readme "$README" --changelog "$CL"
  fi
  rm -rf "$root"
  reset_knobs
}

# R-01 nominal — a guide covering all four areas passes the whole policy.
run_case "R-01 all four areas" pass "docs_observability=pass" "sections=complete"

# R-01 — the RED baseline: the guide file does not exist yet.
GUIDE_MISSING="yes" run_case "R-01 guide missing" fail "docs_observability=fail" "guide=missing"

# R-01 — a guide missing one of the four areas is rejected, and the missing area is named.
MUT="mut_omit_section" MUT_ARG="OpenTelemetry stacks" \
  run_case "R-01 missing otel-stacks" fail "docs_observability=fail" "sections=incomplete" "missing_area=otel-stacks"
MUT="mut_omit_section" MUT_ARG="Environment variables" \
  run_case "R-01 missing env-vars" fail "docs_observability=fail" "sections=incomplete" "missing_area=env-vars"
MUT="mut_omit_section" MUT_ARG="Metrics endpoint" \
  run_case "R-01 missing metrics-endpoint" fail "docs_observability=fail" "sections=incomplete" "missing_area=metrics-endpoint"
MUT="mut_omit_section" MUT_ARG="Verify the image before you deploy" \
  run_case "R-01 missing image-verification" fail "docs_observability=fail" "sections=incomplete" "missing_area=image-verification"

# R-01 — the OpenTelemetry stacks section lists all three recommended stacks (nominal).
run_case "R-01 three stacks" pass "otel_stacks=three"

# R-01 — a stacks section with fewer than three stacks is rejected.
MUT="mut_stacks_two" run_case "R-01 two stacks" fail "docs_observability=fail" "otel_stacks=insufficient"

# R-02 — the no-op default contract is stated explicitly (nominal).
run_case "R-02 noop stated" pass "noop_contract=stated"

# R-02 — a guide that omits the no-op contract is rejected.
MUT="mut_noop_remove" run_case "R-02 noop missing" fail "docs_observability=fail" "noop_contract=missing"

# R-02 — the three OTEL_* variables and their defaults are documented (nominal).
run_case "R-02 env vars documented" pass "env_vars=documented"

# R-04 — the five business metrics match the implementation exactly (nominal).
run_case "R-04 metrics exact" pass "metrics=exact"

# R-04 — a metric documented with a wrong type or tag set is rejected and the metric is named.
MUT="mut_metric_drift" MUT_ARG="sovri.reviews.total" \
  run_case "R-04 reviews total drift" fail "docs_observability=fail" "metrics=mismatch" "metric=sovri.reviews.total"
MUT="mut_metric_drift" MUT_ARG="sovri.findings.total" \
  run_case "R-04 findings total drift" fail "docs_observability=fail" "metrics=mismatch" "metric=sovri.findings.total"
MUT="mut_metric_drift" MUT_ARG="sovri.llm.tokens" \
  run_case "R-04 llm tokens drift" fail "docs_observability=fail" "metrics=mismatch" "metric=sovri.llm.tokens"

# R-04 — the five spans and root attributes match exactly (nominal).
run_case "R-04 spans exact" pass "spans=exact"

# R-04 — a span the implementation does not open is rejected and the span is named.
MUT="mut_span_extra" MUT_ARG="review.post_comment" \
  run_case "R-04 span post_comment" fail "docs_observability=fail" "spans=mismatch" "span=review.post_comment"
MUT="mut_span_extra" MUT_ARG="review.render_summary" \
  run_case "R-04 span render_summary" fail "docs_observability=fail" "spans=mismatch" "span=review.render_summary"

# R-04 — the redaction note is present (nominal).
run_case "R-04 redaction note" pass "redaction_note=present"

# R-03 — the metrics endpoint examples use the shipped port and path (nominal).
run_case "R-03 metrics url consistent" pass "metrics_url=consistent"

# R-03 + R-05 — the verify commands are consistent and framed pre-deploy (nominal).
run_case "R-03 commands consistent pre-deploy" pass "commands=consistent" "verify=pre_deploy"

# R-03 — a verify command pinned to a different image ref, OIDC issuer, or off-scheme tag is rejected.
MUT="mut_verify_image_ref" \
  run_case "R-03 image ref mismatch" fail "docs_observability=fail" "commands=inconsistent" "reason=image_ref"
MUT="mut_verify_oidc" \
  run_case "R-03 oidc mismatch" fail "docs_observability=fail" "commands=inconsistent" "reason=oidc_issuer"
MUT="mut_verify_tag_scheme" \
  run_case "R-03 tag scheme mismatch" fail "docs_observability=fail" "commands=inconsistent" "reason=tag_scheme"

# R-05 — a guide that tells the operator to deploy before verifying is rejected.
MUT="mut_verify_post_deploy" \
  run_case "R-05 verify post deploy" fail "docs_observability=fail" "verify=not_pre_deploy"

# R-06 — a guide that cites only public versioned paths passes (nominal).
run_case "R-06 references public" pass "references=public"

# R-06 — a guide that leaks an internal-only path is rejected and the path is named.
MUT="mut_internal_path" MUT_ARG="PRD.md" \
  run_case "R-06 leak PRD" fail "docs_observability=fail" "references=internal_leak" "path=PRD.md"
MUT="mut_internal_path" MUT_ARG="ARCHI.md" \
  run_case "R-06 leak ARCHI" fail "docs_observability=fail" "references=internal_leak" "path=ARCHI.md"
MUT="mut_internal_path" MUT_ARG="CLAUDE.md" \
  run_case "R-06 leak CLAUDE" fail "docs_observability=fail" "references=internal_leak" "path=CLAUDE.md"
MUT="mut_internal_path" MUT_ARG="specs/example-slug/context.md" \
  run_case "R-06 leak specs" fail "docs_observability=fail" "references=internal_leak" "path=specs/example-slug/context.md"
MUT="mut_internal_path" MUT_ARG=".claude/rules/example.md" \
  run_case "R-06 leak claude dir" fail "docs_observability=fail" "references=internal_leak" "path=.claude/rules/example.md"

# R-07 — a guide that promises out-of-scope surface is rejected and the term is named.
MUT="mut_outscope" MUT_ARG="sarif" \
  run_case "R-07 sarif" fail "docs_observability=fail" "scope=out_of_bounds" "term=sarif"
MUT="mut_outscope" MUT_ARG="dashboard" \
  run_case "R-07 dashboard" fail "docs_observability=fail" "scope=out_of_bounds" "term=dashboard"
MUT="mut_outscope" MUT_ARG="cloud" \
  run_case "R-07 cloud" fail "docs_observability=fail" "scope=out_of_bounds" "term=cloud"

# R-08 — the README Documentation table links the new guide exactly once and the link resolves (nominal).
run_case "R-08 readme row present" pass "readme_row=present"

# R-08 — a README row that is missing, duplicated, or unresolved is rejected.
README_KIND="missing" run_case "R-08 readme row missing" fail "docs_observability=fail" "readme_row=missing"
README_KIND="duplicate" run_case "R-08 readme row duplicate" fail "docs_observability=fail" "readme_row=duplicate"
README_KIND="unresolved" run_case "R-08 readme row unresolved" fail "docs_observability=fail" "readme_row=unresolved"

# R-09 — the changelog records the guide under Unreleased Added (nominal).
run_case "R-09 changelog recorded" pass "changelog=recorded"

# R-09 — a guide with no changelog entry is rejected.
CHANGELOG_KIND="missing" run_case "R-09 changelog missing" fail "docs_observability=fail" "changelog=missing"

# R-10 — clean Markdown passes the formatting contract (nominal).
run_case "R-10 markdown clean" pass "markdown=clean"

# R-10 — curly quotes, non-ASCII, or a title-case heading is rejected and the reason is named.
MUT="mut_markdown" MUT_ARG="curly" \
  run_case "R-10 curly quotes" fail "docs_observability=fail" "markdown=dirty" "reason=curly_quotes"
MUT="mut_markdown" MUT_ARG="nonascii" \
  run_case "R-10 non ascii" fail "docs_observability=fail" "markdown=dirty" "reason=non_ascii"
MUT="mut_markdown" MUT_ARG="titlecase" \
  run_case "R-10 title case heading" fail "docs_observability=fail" "markdown=dirty" "reason=title_case"

# R-10 — a guide that embeds a real-looking credential is rejected. The full-length tokens are
# assembled at runtime with a "" break in the prefix so the literal never appears in this committed
# source — otherwise the repo's own no-secrets content guard would block this very file. MUT_ARG holds
# the assembled, full-length token only in memory; it is written into an ephemeral temp fixture, never
# committed. This is the same dynamic-construction trick scripts/no-secrets.test.sh uses.
GH_PAT="ghp_""0123456789abcdef0123456789abcdef0123"
ANTHROPIC_KEY="sk-ant-""api03-AAAAAAAAAAAAAAAAAAAAAAAA"
MUT="mut_secret" MUT_ARG="$GH_PAT" \
  run_case "R-10 github token" fail "docs_observability=fail" "secret_leak=detected"
MUT="mut_secret" MUT_ARG="$ANTHROPIC_KEY" \
  run_case "R-10 anthropic key" fail "docs_observability=fail" "secret_leak=detected"

# R-01..R-10 + acceptance — the REAL shipped docs satisfy the full policy. This is the case that fails
# in RED (the guide does not exist yet) and that GREEN makes pass by writing the Markdown deliverables.
assert_pass "acceptance real docs" \
  "docs_observability=pass" "sections=complete" "metrics=exact" "spans=exact" "references=public" \
  "readme_row=present" "changelog=recorded" -- \
  --doc "$REAL_DOC" --readme "$REAL_README" --changelog "$REAL_CHANGELOG"

if [ "$FAIL" -ne 0 ]; then
  printf 'docs-observability-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'docs-observability-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
