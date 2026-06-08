#!/usr/bin/env bash
# Acceptance tests for the SLSA build-provenance attestation release policy (task-133, R-01..R-10).
#
# Drives `node scripts/ci-policy.mjs slsa-provenance --workflow <release.yml> --changelog <CHANGELOG.md>`
# the same way task-132 tested cosign keyless signing. A real `v*` build-provenance run cannot execute
# in the suite (it needs a live GHCR push + GitHub OIDC + the attestations API), so each Gherkin
# scenario is exercised as a static policy over a fixture workflow, and a final @technical case asserts
# the REAL `.github/workflows/release.yml` + `CHANGELOG.md` satisfy it.
#
# Each test mirrors one acceptance scenario for SLSA build-provenance attestation (task-133, R-01..R-10):
# one attestation bound to the signed digest, least-privilege permissions, SHA-pinned actions, a
# documented verify command, and a changelog entry — no secret echoed into logs or the attestation.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/ci-policy.mjs"
REAL_WORKFLOW="$ROOT/.github/workflows/release.yml"
REAL_CHANGELOG="$ROOT/CHANGELOG.md"
IMAGE="ghcr.io/mpiton/sovri/community-bot"
COSIGN_INSTALLER_SHA="d58896d6a1865668819e1d91763c7751a165e159"
ATTEST_PROVENANCE_SHA="c074443f1aee8d4aeeae5536aebba3282517141b"
LOGIN_ACTION_SHA="650006c6eb7dba73a995cc03b0b2d7f5ca915bee"
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

# A complete, correct signed-AND-attested release workflow. Knobs let each case mutate exactly one
# property of the attest-provenance job (or the build-and-push digest output it depends on):
#   TRIGGER          extra trigger lines under `on:` (default: tag-only)
#   BUILD_OUTPUTS    "yes" to expose `outputs.digest` on build-and-push (default: yes)
#   ATTEST_NEEDS     the attest job `needs:` line, indented (default: `    needs: build-and-push`)
#   ATTEST_PERMS     attest-provenance permission lines (default: id-token+attestations+packages+contents)
#   EXTRA_SCOPE      one extra permission line granted to the attest job (default: none)
#   ATTEST_REF       actions/attest-build-provenance ref (default: SHA pin)
#   SUBJECT_NAME     attest subject-name (default: bare image repo)
#   SUBJECT_DIGEST   attest subject-digest (default: the build job output)
#   PUSH_TO_REGISTRY attest push-to-registry value (default: true)
#   VERIFY_COMMENT   include the documented verify commands (default: yes)
#   REBUILD          add a second docker build-push step in the attest job (default: none)
#   OMIT_ATTEST      omit the attest-build-provenance step entirely (default: none)
#   LEAK_STEP        add a step that echoes a credential (credential or empty)
good_workflow() {
  local trigger="${TRIGGER:-}"
  local build_outputs="${BUILD_OUTPUTS:-yes}"
  local attest_needs="${ATTEST_NEEDS-    needs: build-and-push}"
  local attest_perms="${ATTEST_PERMS:-      id-token: write
      attestations: write
      packages: write
      contents: read}"
  local extra_scope="${EXTRA_SCOPE:-}"
  local attest_ref="${ATTEST_REF:-${ATTEST_PROVENANCE_SHA}}"
  # `-` (not `:-`) so SUBJECT_NAME="" passes an empty value through instead of falling back to IMAGE.
  local subject_name="${SUBJECT_NAME-${IMAGE}}"
  local subject_digest="${SUBJECT_DIGEST:-\${{ needs.build-and-push.outputs.digest }}}"
  local push_to_registry="${PUSH_TO_REGISTRY-true}"
  local verify_comment="${VERIFY_COMMENT:-yes}"
  local rebuild="${REBUILD:-}"
  local rebuild_run="${REBUILD_RUN:-}"
  local omit_attest="${OMIT_ATTEST:-}"
  local leak_step="${LEAK_STEP:-}"

  local outputs_block=""
  if [ "$build_outputs" = yes ]; then
    outputs_block="    outputs:
      digest: \${{ steps.build.outputs.digest }}
"
  fi

  local extra=""
  if [ -n "$extra_scope" ]; then
    extra="
${extra_scope}"
  fi

  local needs_line=""
  if [ -n "$attest_needs" ]; then
    needs_line="${attest_needs}
"
  fi

  local rebuild_step=""
  if [ -n "$rebuild" ]; then
    rebuild_step="      - name: Rebuild image
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf
        with:
          push: true
"
  elif [ -n "$rebuild_run" ]; then
    rebuild_step="      - name: Rebuild image
        run: docker buildx build --push -t ${IMAGE}:1.2.3 .
"
  fi

  local verify=""
  if [ "$verify_comment" = yes ]; then
    verify="      # Self-hosters verify provenance before deploy (subject = the released digest):
      #   gh attestation verify oci://${IMAGE}:<tag> --owner mpiton
      #   cosign verify-attestation --type slsaprovenance \\
      #     --certificate-oidc-issuer https://token.actions.githubusercontent.com \\
      #     ${IMAGE}@sha256:<digest>
"
  fi

  local attest_step=""
  if [ -z "$omit_attest" ]; then
    attest_step="      - name: Attest build provenance
        uses: actions/attest-build-provenance@${attest_ref}
        with:
          subject-name: ${subject_name}
          subject-digest: ${subject_digest}
          push-to-registry: ${push_to_registry}
"
  fi

  local leak=""
  if [ -n "$leak_step" ]; then
    leak="      - name: Leak
        run: echo ${leak_step}
"
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
      id-token: write
      packages: write
      contents: read
${outputs_block}    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - name: Build and push Community bot image
        id: build
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
        uses: sigstore/cosign-installer@${COSIGN_INSTALLER_SHA}
      - name: Sign image (keyless)
        run: cosign sign --yes ${IMAGE}@\${{ steps.build.outputs.digest }}

  attest-provenance:
    runs-on: ubuntu-latest
${needs_line}    permissions:
${attest_perms}${extra}
    steps:
      - name: Log in to GHCR
        uses: docker/login-action@${LOGIN_ACTION_SHA}
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
${rebuild_step}${verify}${attest_step}${leak}
YAML
}

good_changelog() {
  cat <<'MARKDOWN'
# Changelog

## [Unreleased]

### Security

- `ci`: attach a SLSA build-provenance attestation to the Community-bot GHCR image, bound to the signed
  digest and verifiable with `gh attestation verify`.

## [0.5.0] - 2026-06-06

- Earlier work.
MARKDOWN
}

bare_changelog() {
  cat <<'MARKDOWN'
# Changelog

## [Unreleased]

### Added

- `ci`: unrelated change with no supply-chain entry.

## [0.5.0] - 2026-06-06

- Earlier work.
MARKDOWN
}

# Knobs are plain shell vars read by good_workflow. run_case resets them after each case so they never
# leak into the next; cases must NOT run in a subshell or their PASS/FAIL counters would be discarded.
reset_knobs() {
  unset TRIGGER BUILD_OUTPUTS ATTEST_NEEDS ATTEST_PERMS EXTRA_SCOPE ATTEST_REF SUBJECT_NAME \
    SUBJECT_DIGEST PUSH_TO_REGISTRY VERIFY_COMMENT REBUILD REBUILD_RUN OMIT_ATTEST LEAK_STEP CHANGELOG_FN
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
  if [ -n "${CHANGELOG_FN:-}" ]; then
    "$CHANGELOG_FN" >"$cl"
  fi
  if [ "$mode" = pass ]; then
    assert_pass "$name" "$@" -- slsa-provenance --workflow "$wf" --changelog "$cl"
  else
    assert_fail "$name" "$@" -- slsa-provenance --workflow "$wf" --changelog "$cl"
  fi
  rm -rf "$root"
  reset_knobs
}

# R-01 nominal — attests the pushed digest on a tag run; the whole policy passes.
run_case "R-01 nominal attest digest" pass "slsa_provenance=pass"

# R-01 — a workflow with no attest-build-provenance step is rejected (RED baseline).
OMIT_ATTEST="yes" run_case "R-01 no attest step" fail "slsa_provenance=fail" "attest_step=missing"

# R-01 — the attestation must be pushed to the registry to be attached to the GHCR image.
PUSH_TO_REGISTRY="false" run_case "R-01 push false" fail "slsa_provenance=fail" "push_to_registry=disabled"
PUSH_TO_REGISTRY="" run_case "R-01 push empty" fail "slsa_provenance=fail" "push_to_registry=disabled"

# R-01 — subject-name keyed by a mutable tag is rejected; it must be the bare repo path.
SUBJECT_NAME="${IMAGE}:latest" run_case "R-01 subject tag latest" fail "slsa_provenance=fail" "subject_name=tagged"
SUBJECT_NAME="${IMAGE}:\${{ steps.image-tags.outputs.full }}" run_case "R-01 subject tag expr" fail "slsa_provenance=fail" "subject_name=tagged"

# R-01 — an empty subject-name is rejected, not deferred to runtime.
SUBJECT_NAME="" run_case "R-01 subject empty" fail "slsa_provenance=fail" "subject_name=tagged"

# R-02 — the build-and-push job surfaces the pushed digest as a job output (nominal).
run_case "R-02 subject digest wired" pass "subject_digest=wired"

# R-02 — without a job-level digest output, no downstream job can bind to the exact artifact.
BUILD_OUTPUTS="no" run_case "R-02 job output missing" fail "slsa_provenance=fail" "job_output=missing"

# R-02 — a subject-digest that is not the wired build job output is rejected.
SUBJECT_DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000" \
  run_case "R-02 literal digest" fail "slsa_provenance=fail" "subject_digest=not_wired"
SUBJECT_DIGEST="\${{ steps.image-tags.outputs.full }}" \
  run_case "R-02 tag expr digest" fail "slsa_provenance=fail" "subject_digest=not_wired"

# R-03 — provenance and cosign bind the same build-and-push digest (nominal).
run_case "R-03 digest binding shared" pass "digest_binding=shared"

# R-03 — an attest job that rebuilds the image is rejected (no rebuild between sign and attest),
# whether via a build-push action or a raw `run: docker buildx build` shell step.
REBUILD="yes" run_case "R-03 rebuild detected" fail "slsa_provenance=fail" "rebuild=detected"
REBUILD_RUN="yes" run_case "R-03 rebuild via run" fail "slsa_provenance=fail" "rebuild=detected"

# R-04 — exactly id-token+attestations+packages write, contents read (nominal).
run_case "R-04 scoped perms" pass "permissions=scoped"

# R-04 — missing each required write is rejected with its own token.
ATTEST_PERMS="      id-token: write
      packages: write
      contents: read" run_case "R-04 attestations missing" fail "slsa_provenance=fail" "attestations=missing"
ATTEST_PERMS="      attestations: write
      packages: write
      contents: read" run_case "R-04 id-token missing" fail "slsa_provenance=fail" "id_token=missing"
ATTEST_PERMS="      id-token: write
      attestations: write
      contents: read" run_case "R-04 packages missing" fail "slsa_provenance=fail" "packages=missing"

# R-04 — a broader scope than needed is rejected.
ATTEST_PERMS="      id-token: write
      attestations: write
      packages: write
      contents: write" run_case "R-04 contents write overbroad" fail "slsa_provenance=fail" "permissions=overbroad"
# R-04 — contents must be pinned to read explicitly; a missing contents key is over-broad too.
ATTEST_PERMS="      id-token: write
      attestations: write
      packages: write" run_case "R-04 contents missing overbroad" fail "slsa_provenance=fail" "permissions=overbroad"
EXTRA_SCOPE="      actions: write" run_case "R-04 actions write overbroad" fail "slsa_provenance=fail" "permissions=overbroad"

# R-05 — the attest job depends on build-and-push so the digest is signed first (nominal).
run_case "R-05 ordering after signing" pass "ordering=after_signing"

# R-05 — an attest job that does not need build-and-push is rejected.
ATTEST_NEEDS="" run_case "R-05 ordering not after signing" fail "slsa_provenance=fail" "ordering=not_after_signing"

# R-06 — a floating attest-build-provenance ref is rejected; a SHA pin passes.
ATTEST_REF="v1" run_case "R-06 floating v1" fail "slsa_provenance=fail" "action_pinning=unpinned"
ATTEST_REF="v2" run_case "R-06 floating v2" fail "slsa_provenance=fail" "action_pinning=unpinned"
ATTEST_REF="main" run_case "R-06 main ref" fail "slsa_provenance=fail" "action_pinning=unpinned"
run_case "R-06 sha pinned" pass "action_pinning=pinned"

# R-07 — the workflow documents the gh attestation verify and cosign verify-attestation commands.
run_case "R-07 verify documented" pass "verify_command=documented"

# R-07 — attesting without a documented verify command is rejected.
VERIFY_COMMENT="no" run_case "R-07 verify missing" fail "slsa_provenance=fail" "verify_command=missing"

# R-08 — attestation is additive; the existing build-and-push contract still passes on the real workflow.
assert_pass "R-08 release-build-and-push unchanged" "release_build_and_push=pass" -- \
  release-build-and-push --workflow "$REAL_WORKFLOW"

# R-09 — a step that echoes a credential into logs is rejected.
LEAK_STEP="\${{ secrets.GITHUB_TOKEN }}" run_case "R-09 leak github token" fail "slsa_provenance=fail" "secret_leak=detected"
LEAK_STEP="\$ACTIONS_ID_TOKEN_REQUEST_TOKEN" run_case "R-09 leak oidc token" fail "slsa_provenance=fail" "secret_leak=detected"

# R-10 — the changelog records SLSA provenance under Unreleased (nominal).
run_case "R-10 changelog recorded" pass "changelog=recorded"

# R-10 — attesting with no changelog provenance entry is rejected.
CHANGELOG_FN="bare_changelog" run_case "R-10 changelog missing" fail "slsa_provenance=fail" "changelog=missing"

# R-09 + R-10 + acceptance — the REAL release.yml and CHANGELOG satisfy the full slsa provenance policy.
assert_pass "acceptance real workflow" "slsa_provenance=pass" -- \
  slsa-provenance --workflow "$REAL_WORKFLOW" --changelog "$REAL_CHANGELOG"

if [ "$FAIL" -ne 0 ]; then
  printf 'slsa-provenance-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'slsa-provenance-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
