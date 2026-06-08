#!/usr/bin/env bash
# Acceptance tests for the cosign keyless image-signing release policy (task-132, R-01..R-09).
#
# Drives `node scripts/ci-policy.mjs cosign-signing --workflow <release.yml> --changelog <CHANGELOG.md>`
# the same way the other CI gates are tested (task-103 coverage gate, the OpenAI/Mistral SDK policies).
# A real keyless `v*` signing run cannot execute in the suite (it needs a live GHCR push + Sigstore +
# GitHub OIDC), so each Gherkin scenario is exercised as a static policy over a fixture workflow, and a
# final @technical case asserts the REAL `.github/workflows/release.yml` + `CHANGELOG.md` satisfy it.
#
# Each test mirrors one Scenario from
# specs/task-132-cosign-image-signing/cosign-image-signing.feature.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/ci-policy.mjs"
REAL_WORKFLOW="$ROOT/.github/workflows/release.yml"
REAL_CHANGELOG="$ROOT/CHANGELOG.md"
IMAGE="ghcr.io/mpiton/sovri/community-bot"
COSIGN_INSTALLER_SHA="d58896d6a1865668819e1d91763c7751a165e159"
PASS=0
FAIL=0
FAILURES=""

record_failure() {
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  x ${1}: ${2}"
}

# Run the policy, assert exit 0 and that stdout contains every expected token.
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
  out=$(node "$SCRIPT" "$@" 2>&1)
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

# Run the policy, assert non-zero exit and that output contains every expected token.
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
  out=$(node "$SCRIPT" "$@" 2>&1)
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

# A complete, correct signed release workflow. Knobs let each case mutate exactly one property:
#   TRIGGER          extra trigger lines under `on:` (default: tag-only)
#   BUILD_ID         build step id (default: build)
#   PERMS            build-and-push permission lines (default: id-token+packages+contents)
#   EXTRA_JOB_PERM   an `id-token: write` granted to another job (job name or empty)
#   COSIGN_REF       sigstore/cosign-installer ref (default: SHA pin)
#   SIGN_TARGET      argument signed (default: digest by build output)
#   SIGN_KEY         optional `--key ...` argument (default: empty -> keyless)
#   VERIFY_COMMENT   include the documented verify command (default: yes)
#   LEAK_STEP        add a step that echoes a credential (credential or empty)
good_workflow() {
  local trigger="${TRIGGER:-}"
  local build_id="${BUILD_ID:-build}"
  local perms="${PERMS:-      id-token: write
      packages: write
      contents: read}"
  local extra_job_perm="${EXTRA_JOB_PERM:-}"
  local cosign_ref="${COSIGN_REF:-${COSIGN_INSTALLER_SHA}}"
  local sign_target="${SIGN_TARGET:-${IMAGE}@\${{ steps.build.outputs.digest }}}"
  local sign_key="${SIGN_KEY:-}"
  local verify_comment="${VERIFY_COMMENT:-yes}"
  local leak_step="${LEAK_STEP:-}"

  local extra_job=""
  if [ -n "$extra_job_perm" ]; then
    extra_job="
  ${extra_job_perm}:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - run: echo other job"
  fi

  local leak=""
  if [ -n "$leak_step" ]; then
    leak="
      - name: Leak
        run: echo ${leak_step}"
  fi

  local verify=""
  if [ "$verify_comment" = yes ]; then
    verify="      # Self-hosters verify the signed image before deploy (cert identity = this workflow,
      # issuer = GitHub Actions OIDC):
      #   cosign verify ${IMAGE}@sha256:<digest> \\
      #     --certificate-identity-regexp \"^https://github.com/mpiton/sovri/.github/workflows/release.yml@.*\" \\
      #     --certificate-oidc-issuer https://token.actions.githubusercontent.com
"
  fi

  local key_arg=""
  if [ -n "$sign_key" ]; then
    key_arg="${sign_key} "
  fi

  cat <<YAML
name: Release

on:
  push:
    tags:
      - "v*"${trigger}

permissions:
  contents: read

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
${perms}
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - name: Build and push Community bot image
        id: ${build_id}
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ${IMAGE}:1.2.3
            ${IMAGE}:1.2
            ${IMAGE}:1
            ${IMAGE}:latest
      - name: Install cosign
        uses: sigstore/cosign-installer@${cosign_ref}
${verify}      - name: Sign image (keyless)
        run: cosign sign --yes ${key_arg}${sign_target}${leak}${extra_job}
YAML
}

good_changelog() {
  cat <<'MARKDOWN'
# Changelog

## [Unreleased]

### Security

- `ci`: sign the Community-bot GHCR image with cosign keyless (Sigstore + GitHub OIDC), verifiable by
  digest before deploy.

## [0.3.0] - 2026-05-23

- Cosign signing is deferred to v0.5.
MARKDOWN
}

stale_changelog() {
  cat <<'MARKDOWN'
# Changelog

## [Unreleased]

### Added

- Cosign signing is deferred to v0.5.

## [0.3.0] - 2026-05-23

- Earlier work.
MARKDOWN
}

# Knobs are plain shell vars read by good_workflow. run_case resets them after each case so
# they never leak into the next; cases must NOT run in a subshell or their PASS/FAIL counters
# would be discarded by the parent.
reset_knobs() {
  unset TRIGGER BUILD_ID PERMS EXTRA_JOB_PERM COSIGN_REF SIGN_TARGET SIGN_KEY \
    VERIFY_COMMENT LEAK_STEP CHANGELOG_FN
}

run_case() {
  local name="$1"
  local mode="$2"
  shift 2
  local root wf cl
  root=$(mktemp -d)
  wf="$root/release.yml"
  cl="$root/CHANGELOG.md"
  good_workflow >"$wf"
  good_changelog >"$cl"
  # The remaining args are token assertions terminated by `--`; the caller has already
  # set the knobs and may override the changelog via $CHANGELOG_FN.
  if [ -n "${CHANGELOG_FN:-}" ]; then
    "$CHANGELOG_FN" >"$cl"
  fi
  if [ "$mode" = pass ]; then
    assert_pass "$name" "$@" -- cosign-signing --workflow "$wf" --changelog "$cl"
  else
    assert_fail "$name" "$@" -- cosign-signing --workflow "$wf" --changelog "$cl"
  fi
  rm -rf "$root"
  reset_knobs
}

no_sign_workflow() {
  cat <<YAML
name: Release
on:
  push:
    tags:
      - "v*"
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
    steps:
      - name: Build and push Community bot image
        id: build
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ${IMAGE}:1.2.3
            ${IMAGE}:latest
YAML
}

run_no_sign_case() {
  local root
  root=$(mktemp -d)
  no_sign_workflow >"$root/release.yml"
  good_changelog >"$root/CHANGELOG.md"
  assert_fail "R-01 no sign step" "cosign_signing=fail" "sign_step=missing" -- \
    cosign-signing --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"
  rm -rf "$root"
}

# R-01 nominal — signs the pushed digest keyless on a tag-only run.
run_case "R-01 nominal sign digest keyless" pass "cosign_signing=pass"

# R-01 — a workflow with no cosign sign step at all is rejected (RED baseline).
run_no_sign_case

# R-01 — signing gated on the v* tag trigger; a pull_request trigger is rejected.
TRIGGER="
  pull_request:" run_case "R-01 pr trigger rejected" fail "cosign_signing=fail" "trigger=not_tag_only"

# R-02 — keyless only: a --key argument is rejected.
SIGN_KEY="--key cosign.key" run_case "R-02 file key" fail "cosign_signing=fail" "keyless=violated"
SIGN_KEY="--key env://COSIGN_PRIVATE_KEY" run_case "R-02 env key" fail "cosign_signing=fail" "keyless=violated"
SIGN_KEY="--key awskms://alias/sovri-signing" run_case "R-02 kms key" fail "cosign_signing=fail" "keyless=violated"

# R-03 — signing a mutable tag instead of the digest is rejected.
SIGN_TARGET="${IMAGE}:latest" run_case "R-03 latest tag" fail "cosign_signing=fail" "sign_target=tag_not_digest"
SIGN_TARGET="${IMAGE}:\${{ steps.image-tags.outputs.full }}" run_case "R-03 tag expr" fail "cosign_signing=fail" "sign_target=tag_not_digest"

# R-03 — the signed digest is wired from the build step output (nominal).
run_case "R-03 digest wired" pass "sign_target=digest"

# R-04 — exactly id-token+packages+contents on build-and-push, no other job widened.
run_case "R-04 scoped perms" pass "permissions=scoped"

# R-04 — a build-and-push job without id-token: write is rejected.
PERMS="      packages: write
      contents: read" run_case "R-04 missing id-token" fail "cosign_signing=fail" "id_token=missing"

# R-04 — id-token: write on another job is rejected as widened.
EXTRA_JOB_PERM="verify-tag" run_case "R-04 widened verify-tag" fail "cosign_signing=fail" "permissions=widened"
EXTRA_JOB_PERM="sbom" run_case "R-04 widened sbom" fail "cosign_signing=fail" "permissions=widened"
EXTRA_JOB_PERM="gh-release" run_case "R-04 widened gh-release" fail "cosign_signing=fail" "permissions=widened"

# R-05 — the workflow documents the client verify command.
run_case "R-05 verify documented" pass "verify_command=documented"

# R-05 — signing without a documented verify command is rejected.
VERIFY_COMMENT="no" run_case "R-05 verify missing" fail "cosign_signing=fail" "verify_command=missing"

# R-06 — a floating cosign-installer ref is rejected; a SHA pin passes.
COSIGN_REF="v3.7.0" run_case "R-06 floating tag" fail "cosign_signing=fail" "action_pinning=unpinned"
COSIGN_REF="main" run_case "R-06 main ref" fail "cosign_signing=fail" "action_pinning=unpinned"
COSIGN_REF="master" run_case "R-06 master ref" fail "cosign_signing=fail" "action_pinning=unpinned"
run_case "R-06 sha pinned" pass "action_pinning=pinned"

# R-07 — signing is additive; the existing build-and-push contract still passes on the real workflow.
assert_pass "R-07 release-build-and-push unchanged" "release_build_and_push=pass" -- \
  release-build-and-push --workflow "$REAL_WORKFLOW"

# R-08 — changelog records cosign under Unreleased and drops the deferral claim (nominal).
run_case "R-08 changelog recorded" pass "changelog=recorded"

# R-08 — a changelog still deferring cosign while the workflow signs is rejected.
CHANGELOG_FN="stale_changelog" run_case "R-08 stale deferral" fail "cosign_signing=fail" "changelog=stale_deferral"

# R-09 — a step that echoes a credential into logs is rejected.
LEAK_STEP="\${{ secrets.GITHUB_TOKEN }}" run_case "R-09 leak github token" fail "cosign_signing=fail" "secret_leak=detected"
LEAK_STEP="\$ACTIONS_ID_TOKEN_REQUEST_TOKEN" run_case "R-09 leak oidc token" fail "cosign_signing=fail" "secret_leak=detected"

# R-09 + acceptance — the REAL release.yml and CHANGELOG satisfy the full cosign signing policy.
assert_pass "acceptance real workflow" "cosign_signing=pass" -- \
  cosign-signing --workflow "$REAL_WORKFLOW" --changelog "$REAL_CHANGELOG"

if [ "$FAIL" -ne 0 ]; then
  printf 'cosign-signing-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'cosign-signing-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
