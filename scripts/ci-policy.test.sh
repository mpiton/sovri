#!/usr/bin/env bash
# Acceptance tests for scripts/ci-policy.mjs.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/ci-policy.mjs"

PASS=0
FAIL=0
FAILURES=""

run_coverage_gate_branch_case() {
  local label="$1"
  local covered="$2"
  local total="$3"
  local expected_exit="$4"
  local expected_status_line="$5"
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-coverage')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  mkdir -p "$tmp/coverage"
  cat >"$tmp/coverage/coverage-summary.json" <<EOF
{
  "total": {
    "branches": { "total": 1000, "covered": 920, "skipped": 0, "pct": 92 }
  },
  "/repo/packages/llm-providers/src/providers/MistralProvider.ts": {
    "branches": { "total": ${total}, "covered": ${covered}, "skipped": 0, "pct": 0 }
  }
}
EOF

  # Given "coverage/coverage-summary.json" reports <covered>/<total> branch units
  # for "packages/llm-providers"
  node "$SCRIPT" coverage-gate \
    --input "$tmp/coverage/coverage-summary.json" \
    --package packages/llm-providers \
    --branches 85 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the llm-providers coverage gate
  # Then the gate exits with code <expected_exit>
  if [ "$ec" -ne "$expected_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ coverage gate ${label}: expected exit ${expected_exit}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And stdout includes "<expected_status_line>"
  if ! printf '%s\n' "$stdout" | grep -Fq "$expected_status_line"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ coverage gate ${label}: missing status line ${expected_status_line}
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_coverage_gate_workspace_total_case() {
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-coverage')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  mkdir -p "$tmp/coverage"
  cat >"$tmp/coverage/coverage-summary.json" <<EOF
{
  "total": {
    "branches": { "total": 100, "covered": 92, "skipped": 0, "pct": 92 }
  },
  "/repo/packages/llm-providers/src/providers/MistralProvider.ts": {
    "branches": { "total": 100, "covered": 84, "skipped": 0, "pct": 84 }
  },
  "/repo/packages/core/src/index.ts": {
    "branches": { "total": 100, "covered": 100, "skipped": 0, "pct": 100 }
  }
}
EOF

  # Given the workspace total branch coverage is 92 percent
  # And "packages/llm-providers" branch coverage is 84 percent
  node "$SCRIPT" coverage-gate \
    --input "$tmp/coverage/coverage-summary.json" \
    --package packages/llm-providers \
    --branches 85 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the llm-providers coverage gate
  # Then the gate fails using package coverage rather than workspace totals
  if [ "$ec" -ne 1 ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "coverage_gate=fail" ||
    ! printf '%s\n' "$stdout" | grep -Fq "packages/llm-providers branches 84.00 < 85.00"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ coverage gate workspace total isolation failed
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

write_coverage_workflow_fixture() {
  local path="$1"
  local threshold="$2"
  local retention_days="$3"
  local upload_condition="$4"

  cat >"$path" <<EOF
name: CI

on:
  pull_request:

jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Enable pnpm for setup-node cache
        run: corepack enable
      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - name: Build
        run: pnpm turbo build
      - name: Typecheck
        run: pnpm exec tsc -b
      - name: Run coverage
        run: pnpm exec vitest run --coverage --reporter=verbose
      - name: Coverage gate — packages/llm-providers ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/llm-providers ${threshold}
      - name: Upload TypeScript coverage
        if: ${upload_condition}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: ts-coverage
          path: coverage/
          retention-days: ${retention_days}
EOF
}

run_llm_providers_workflow_threshold_case() {
  local threshold="$1"
  local expected_exit="$2"
  local expected_status="$3"
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-workflow')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  write_coverage_workflow_fixture "$tmp/ci.yml" "$threshold" 90 "always()"

  # Given the candidate workflow sets the llm-providers branch threshold to <threshold>
  node "$SCRIPT" llm-providers-coverage-workflow --workflow "$tmp/ci.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the candidate workflow
  # Then lowering the threshold below 85 percent is rejected
  if [ "$ec" -ne "$expected_exit" ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "$expected_status"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ llm-providers threshold ${threshold}: expected exit ${expected_exit} with ${expected_status}
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_llm_providers_workflow_pnpm_cache_bootstrap_case() {
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-workflow')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$tmp/ci.yml" <<EOF
name: CI

on:
  pull_request:

jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - name: Enable pnpm
        run: corepack enable
      - name: Run coverage
        run: pnpm exec vitest run --coverage --reporter=verbose
      - name: Coverage gate — packages/llm-providers ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/llm-providers 85
EOF

  # Given setup-node enables the pnpm cache before pnpm is bootstrapped
  node "$SCRIPT" llm-providers-coverage-workflow --workflow "$tmp/ci.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the coverage workflow
  # Then the policy rejects the clean-runner cache ordering
  if [ "$ec" -ne 1 ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "pnpm_cache_bootstrap=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ llm-providers workflow pnpm cache bootstrap should fail before corepack
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_llm_providers_workflow_typecheck_before_build_case() {
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-workflow')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$tmp/ci.yml" <<EOF
name: CI

on:
  pull_request:

jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Enable pnpm for setup-node cache
        run: corepack enable
      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - name: Typecheck
        run: pnpm exec tsc -b
      - name: Build
        run: pnpm turbo build
      - name: Run coverage
        run: pnpm exec vitest run --coverage --reporter=verbose
      - name: Coverage gate — packages/llm-providers ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/llm-providers 85
EOF

  # Given typecheck runs before workspace packages emit dist declarations
  node "$SCRIPT" llm-providers-coverage-workflow --workflow "$tmp/ci.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the coverage workflow
  # Then the policy rejects typecheck before build on clean runners
  if [ "$ec" -ne 1 ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "build_before_typecheck=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ llm-providers workflow typecheck should not run before build
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_coverage_artifact_policy_case() {
  local retention_days="$1"
  local upload_condition="$2"
  local expected_exit="$3"
  local expected_status="$4"
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-artifact')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  write_coverage_workflow_fixture "$tmp/ci.yml" 85 "$retention_days" "$upload_condition"

  # Given the coverage upload step uses retention-days <retention_days>
  # And the upload condition is "<upload_condition>"
  node "$SCRIPT" coverage-artifact-policy --workflow "$tmp/ci.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  # When the release engineer evaluates the CI coverage artifact policy
  # Then the policy exits with code <expected_exit>
  if [ "$ec" -ne "$expected_exit" ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "$expected_status"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ coverage artifact retention ${retention_days}, condition ${upload_condition}: expected ${expected_status}
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_duration_pass_case() {
  local elapsed_ms="$1"
  local reported_duration="$2"
  local end_ms stdout stderr stdout_file stderr_file ec

  end_ms=$((100000 + elapsed_ms))
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm store cache restore outcome is "hit"
  # And the Turborepo cache restore outcome is "hit"
  # And the backend-checks job starts at monotonic time 100000 ms
  # And the backend-checks job completes after <elapsed_ms> ms
  node "$SCRIPT" duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$end_ms" \
    --pnpm-cache hit \
    --turbo-cache hit \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit pass ${elapsed_ms} ms: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the backend-checks duration budget is evaluated
  # Then the duration budget assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit pass ${elapsed_ms} ms: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the reported backend-checks duration is "<reported_duration>"
  if ! printf '%s\n' "$stdout" | grep -Fq "reported_duration=${reported_duration}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit pass ${elapsed_ms} ms: missing reported duration ${reported_duration}
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_duration_fail_case() {
  local elapsed_ms="$1"
  local end_ms stdout stderr stdout_file stderr_file ec

  end_ms=$((100000 + elapsed_ms))
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm store cache restore outcome is "hit"
  # And the Turborepo cache restore outcome is "hit"
  # And the backend-checks job starts at monotonic time 100000 ms
  # And the backend-checks job completes after <elapsed_ms> ms
  node "$SCRIPT" duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$end_ms" \
    --pnpm-cache hit \
    --turbo-cache hit \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # When the backend-checks duration budget is evaluated
  # Then the duration budget assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit fail ${elapsed_ms} ms: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit fail ${elapsed_ms} ms: missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "backend-checks must finish in under 5 minutes on cache hit"
  if ! printf '%s\n' "$stderr" | grep -Fq "backend-checks must finish in under 5 minutes on cache hit"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache-hit fail ${elapsed_ms} ms: missing failure message
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_duration_queue_exclusion_case() {
  local stdout stderr stdout_file stderr_file ec

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the backend-checks workflow run waits in the GitHub Actions queue
  # for 120000 ms (queue time is excluded from the measurement because
  # --job-start-ms anchors at the runner-start instant, not the workflow-trigger instant)
  # And the pnpm store cache restore outcome is "hit"
  # And the Turborepo cache restore outcome is "hit"
  # And the backend-checks job runs for 240000 ms after the runner starts
  node "$SCRIPT" duration-budget \
    --job-start-ms 100000 \
    --job-end-ms 340000 \
    --pnpm-cache hit \
    --turbo-cache hit \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ queue exclusion: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the backend-checks duration budget is evaluated
  # Then the measured duration is 240000 ms
  if ! printf '%s\n' "$stdout" | grep -Fq "measured_duration_ms=240000"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ queue exclusion: missing measured duration 240000 ms
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the duration budget assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ queue exclusion: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_duration_cache_miss_case() {
  local stdout stderr stdout_file stderr_file ec

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm store cache restore outcome is "miss"
  # And the Turborepo cache restore outcome is "hit"
  # And the backend-checks job completes after 360000 ms
  node "$SCRIPT" duration-budget \
    --job-start-ms 100000 \
    --job-end-ms 460000 \
    --pnpm-cache miss \
    --turbo-cache hit \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache miss: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the backend-checks duration budget is evaluated
  # Then the run is classified as "cache-miss"
  if ! printf '%s\n' "$stdout" | grep -Fq "run_classification=cache-miss"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache miss: missing cache-miss classification
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the run is not accepted as evidence for R-01
  if ! printf '%s\n' "$stdout" | grep -Fq "r01_evidence=not-accepted"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache miss: missing not-accepted evidence status
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the cache-hit duration budget result is not reported as passing
  if printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ cache miss: cache-hit budget must not be reported as passing
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_pull_request_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on:
  pull_request:
jobs:
  changelog-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

  # Given the CI workflow declares these events:
  #   | event        |
  #   | pull_request |
  # And the CI workflow contains the "changelog-check" job
  # And the "changelog-check" job is eligible for event "pull_request"
  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check trigger rule is evaluated
  # Then the changelog-check trigger assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_trigger=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the job is eligible to run for event "pull_request"
  if ! printf '%s\n' "$stdout" | grep -Fq "eligible_event=pull_request"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request: missing pull_request eligibility
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_inline_event_syntax_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on: [push, pull_request]
jobs:
  changelog-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger inline event syntax: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "eligible_event=pull_request"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger inline event syntax: missing pull_request eligibility
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_expression_condition_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on:
  pull_request:
jobs:
  changelog-check:
    if: ${{ github.event_name == 'pull_request' }}
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger expression condition: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "eligible_event=pull_request"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger expression condition: missing pull_request eligibility
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_missing_job_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on:
  pull_request:
jobs:
  forbidden-tools:
    runs-on: ubuntu-latest
    steps:
      - name: Check forbidden tools
        run: node scripts/ci-policy.mjs forbidden-tools
YAML

  # Given the CI workflow declares these events:
  #   | event        |
  #   | pull_request |
  # And the CI workflow does not contain the "changelog-check" job
  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  # When the changelog-check trigger rule is evaluated
  # Then the changelog-check trigger assertion fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger missing job: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_trigger=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger missing job: missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "missing changelog-check job"
  if ! printf '%s\n' "$combined" | grep -Fq "missing changelog-check job"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger missing job: missing remediation text
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_non_pull_request_eligibility_case() {
  local event workflow_file stdout stderr stdout_file stderr_file ec combined

  for event in push workflow_dispatch schedule; do
    workflow_file=$(mktemp)
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    cat >"$workflow_file" <<YAML
on:
  pull_request:
  push:
  workflow_dispatch:
  schedule:
    - cron: "0 0 * * *"
jobs:
  changelog-check:
    if: github.event_name == '${event}'
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

    # Given the CI workflow declares these events:
    #   | event             |
    #   | pull_request      |
    #   | push              |
    #   | workflow_dispatch |
    #   | schedule          |
    # And the CI workflow contains the "changelog-check" job
    # And the "changelog-check" job is eligible for event "<event>"
    node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    combined="${stdout}
${stderr}"
    rm -f "$workflow_file" "$stdout_file" "$stderr_file"

    # When the changelog-check trigger rule is evaluated
    # Then the changelog-check trigger assertion fails
    if [ "$ec" -eq 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog trigger non-pull-request eligibility (${event}): expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "changelog_trigger=fail"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog trigger non-pull-request eligibility (${event}): missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the failure mentions "changelog-check must run on pull_request only"
    if ! printf '%s\n' "$combined" | grep -Fq "changelog-check must run on pull_request only"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog trigger non-pull-request eligibility (${event}): missing remediation text
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    PASS=$((PASS + 1))
  done
}

run_changelog_trigger_other_workflow_events_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on:
  pull_request:
  push:
  schedule:
    - cron: "0 0 * * *"
jobs:
  changelog-check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

  # Given the CI workflow declares these events:
  #   | event        |
  #   | pull_request |
  #   | push         |
  #   | schedule     |
  # And the CI workflow contains the "changelog-check" job
  # And the "changelog-check" job is eligible for event "pull_request"
  # And the "changelog-check" job is not eligible for event "push"
  # And the "changelog-check" job is not eligible for event "schedule"
  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger other workflow events: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check trigger rule is evaluated
  # Then the changelog-check trigger assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_trigger=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger other workflow events: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_trigger_pull_request_target_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
on:
  pull_request_target:
jobs:
  changelog-check:
    if: github.event_name == 'pull_request_target'
    runs-on: ubuntu-latest
    steps:
      - name: Check changelog
        run: node scripts/ci-policy.mjs changelog-diff --base origin/main --head HEAD
YAML

  # Given the CI workflow declares these events:
  #   | event               |
  #   | pull_request_target |
  # And the CI workflow contains the "changelog-check" job
  # And the "changelog-check" job is eligible for event "pull_request_target"
  node "$SCRIPT" changelog-trigger --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  # When the changelog-check trigger rule is evaluated
  # Then the changelog-check trigger assertion fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request_target: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_trigger=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request_target: missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "missing pull_request trigger"
  if ! printf '%s\n' "$combined" | grep -Fq "missing pull_request trigger"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog trigger pull_request_target: missing remediation text
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_ci_only_pass_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                     |
  #   | .github/workflows/ci.yml |
  #   | .github/dependabot.yml   |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files ".github/workflows/ci.yml,.github/dependabot.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff CI-only pass: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate evaluates the pull request diff
  # Then the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff CI-only pass: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the gate result is "success"
  if ! printf '%s\n' "$stdout" | grep -Fq "gate_result=success"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff CI-only pass: missing success result
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_ci_only_failure_assertion_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                         |
  #   | .github/workflows/release.yml |
  #   | scripts/no-secrets.sh         |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-ci-only-assert \
    --changed-files ".github/workflows/release.yml,scripts/no-secrets.sh" \
    --gate-result failure \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the pull request diff
  # Then the R-02 assertion fails if the gate result is "failure"
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog CI-only failure assertion: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "r02_assertion=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog CI-only failure assertion: missing R-02 failure status
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "CI-only PR must not require CHANGELOG.md"
  if ! printf '%s\n' "$combined" | grep -Fq "CI-only PR must not require CHANGELOG.md"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog CI-only failure assertion: missing remediation text
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_workflow_classification_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                         |
  #   | .github/workflows/ci.yml     |
  #   | .github/workflows/codeql.yml |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files ".github/workflows/ci.yml,.github/workflows/codeql.yml" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff workflow classification: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate classifies changed files
  # Then ".github/workflows/ci.yml" is classified as "non-code-for-changelog"
  if ! printf '%s\n' "$stdout" | grep -Fq "classification=.github/workflows/ci.yml:non-code-for-changelog"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff workflow classification: missing ci.yml classification
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And ".github/workflows/codeql.yml" is classified as "non-code-for-changelog"
  if ! printf '%s\n' "$stdout" | grep -Fq "classification=.github/workflows/codeql.yml:non-code-for-changelog"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff workflow classification: missing codeql.yml classification
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff workflow classification: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_failure_message_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                                      |
  #   | packages/review-engine/src/orchestrator.ts |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files "packages/review-engine/src/orchestrator.ts" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate builds the failure message
  # Then the failure message mentions "CHANGELOG.md"
  if ! printf '%s\n' "$combined" | grep -Fq "CHANGELOG.md"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message: missing CHANGELOG.md
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # And the failure message mentions ".ts/.tsx"
  if ! printf '%s\n' "$combined" | grep -Fq ".ts/.tsx"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message: missing .ts/.tsx
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # And the failure message mentions "add a changelog entry"
  if ! printf '%s\n' "$combined" | grep -Fq "add a changelog entry"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message: missing remediation
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_remediation_message_vague_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes "packages/core/src/finding.ts"
  # And pull request 53 does not change "CHANGELOG.md"
  # And the produced failure message is "changelog check failed"
  node "$SCRIPT" changelog-remediation-message \
    --message "changelog check failed" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the remediation message is validated
  # Then the remediation-message assertion fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog remediation vague message: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "remediation_message=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog remediation vague message: missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "message must name CHANGELOG.md"
  if ! printf '%s\n' "$combined" | grep -Fq "message must name CHANGELOG.md"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog remediation vague message: missing CHANGELOG.md failure
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "message must explain the remediation"
  if ! printf '%s\n' "$combined" | grep -Fq "message must explain the remediation"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog remediation vague message: missing remediation failure
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_with_changelog_has_no_remediation_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                         |
  #   | packages/core/src/finding.ts |
  #   | CHANGELOG.md                 |
  node "$SCRIPT" changelog-diff \
    --changed-files "packages/core/src/finding.ts,CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff with changelog has no remediation: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate evaluates the pull request diff
  # Then the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff with changelog has no remediation: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And no remediation failure message is produced
  if printf '%s\n%s\n' "$stdout" "$stderr" | grep -Fq "remediation_message=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff with changelog has no remediation: produced remediation failure
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_typescript_with_changelog_pass_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                                        |
  #   | packages/review-engine/src/changelog-gate.ts |
  #   | CHANGELOG.md                                |
  node "$SCRIPT" changelog-diff \
    --changed-files "packages/review-engine/src/changelog-gate.ts,CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript with changelog pass: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate evaluates the pull request diff
  # Then the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript with changelog pass: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the gate result is "success"
  if ! printf '%s\n' "$stdout" | grep -Fq "gate_result=success"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript with changelog pass: missing success result
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_typescript_without_changelog_fails_case() {
  local code_path stdout stderr stdout_file stderr_file ec combined

  for code_path in \
    packages/core/src/severity.ts \
    apps/community-bot/src/server.ts \
    packages/review-engine/src/panel.tsx; do
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    # Given pull request 53 changes these files:
    #   | path        |
    #   | <code_path> |
    # And pull request 53 does not change "CHANGELOG.md"
    node "$SCRIPT" changelog-diff \
      --changed-files "$code_path" \
      >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    combined="${stdout}
${stderr}"
    rm -f "$stdout_file" "$stderr_file"

    # When the changelog-check gate evaluates the pull request diff
    # Then the changelog-check gate fails
    if [ "$ec" -eq 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff TypeScript without changelog fails (${code_path}): expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff TypeScript without changelog fails (${code_path}): missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the failure mentions "CHANGELOG.md"
    if ! printf '%s\n' "$combined" | grep -Fq "CHANGELOG.md"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff TypeScript without changelog fails (${code_path}): missing CHANGELOG.md
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    PASS=$((PASS + 1))
  done
}

run_changelog_diff_mixed_requires_changelog_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                              |
  #   | docs/usage.md                     |
  #   | packages/config/src/load-config.ts |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files "docs/usage.md,packages/config/src/load-config.ts" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the pull request diff
  # Then the changed file set is classified as "requires-changelog"
  if ! printf '%s\n' "$stdout" | grep -Fq "changed_file_set=requires-changelog"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff mixed requires changelog: missing file set classification
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff mixed requires changelog: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff mixed requires changelog: missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_base_head_non_failure_conditions_pass_case() {
  local head_commit changed_files expected_ts expected_changelog stdout stderr stdout_file stderr_file ec combined

  for row in \
    "2222222222222222222222222222222222222222|packages/core/src/finding.ts, CHANGELOG.md|true|true" \
    "4444444444444444444444444444444444444444|docs/usage.md|false|false" \
    "5555555555555555555555555555555555555555|CHANGELOG.md|false|true" \
    "7777777777777777777777777777777777777777|(empty)|false|false"; do
    head_commit=${row%%|*}
    row=${row#*|}
    changed_files=${row%%|*}
    row=${row#*|}
    expected_ts=${row%%|*}
    expected_changelog=${row#*|}
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    # Given the base commit is "1111111111111111111111111111111111111111"
    # And the head commit is "<head_commit>"
    # And the base..head diff has changed files "<changed_files>"
    node "$SCRIPT" changelog-diff \
      --base 1111111111111111111111111111111111111111 \
      --head "$head_commit" \
      --changed-files "$changed_files" \
      >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    combined="${stdout}
${stderr}"
    rm -f "$stdout_file" "$stderr_file"

    if [ "$ec" -ne 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head non-failure pass (${head_commit}): expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    # When the changelog-check gate evaluates the base..head diff
    # Then the changed file set has TypeScript code changes "<has_typescript_code>"
    if ! printf '%s\n' "$stdout" | grep -Fq "has_typescript_code=${expected_ts}"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head non-failure pass (${head_commit}): wrong TypeScript flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the changed file set has a root CHANGELOG.md change "<has_root_changelog>"
    if ! printf '%s\n' "$stdout" | grep -Fq "has_root_changelog=${expected_changelog}"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head non-failure pass (${head_commit}): wrong changelog flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the changelog-check gate passes
    if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head non-failure pass (${head_commit}): missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    PASS=$((PASS + 1))
  done
}

run_changelog_diff_base_head_typescript_without_changelog_fails_case() {
  local head_commit changed_files stdout stderr stdout_file stderr_file ec combined

  for row in \
    "3333333333333333333333333333333333333333|packages/review-engine/src/orchestrator.ts, docs/review.md" \
    "6666666666666666666666666666666666666666|docs/CHANGELOG.md, packages/config/src/schema.ts" \
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|apps/community-bot/src/panel.tsx"; do
    head_commit=${row%%|*}
    changed_files=${row#*|}
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    # Given the base commit is "1111111111111111111111111111111111111111"
    # And the head commit is "<head_commit>"
    # And the base..head diff has changed files "<changed_files>"
    node "$SCRIPT" changelog-diff \
      --base 1111111111111111111111111111111111111111 \
      --head "$head_commit" \
      --changed-files "$changed_files" \
      >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    combined="${stdout}
${stderr}"
    rm -f "$stdout_file" "$stderr_file"

    # When the changelog-check gate evaluates the base..head diff
    # Then the changed file set has TypeScript code changes
    if ! printf '%s\n' "$stdout" | grep -Fq "has_typescript_code=true"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head TypeScript without changelog (${head_commit}): missing TypeScript flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the changed file set does not have a root CHANGELOG.md change
    if ! printf '%s\n' "$stdout" | grep -Fq "has_root_changelog=false"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head TypeScript without changelog (${head_commit}): wrong changelog flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    # And the changelog-check gate fails
    if [ "$ec" -eq 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head TypeScript without changelog (${head_commit}): expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
      return
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ changelog diff base-head TypeScript without changelog (${head_commit}): missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
      return
    fi

    PASS=$((PASS + 1))
  done
}

run_changelog_diff_typescript_rename_without_changelog_fails_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the base commit is "1111111111111111111111111111111111111111"
  # And the head commit is "8888888888888888888888888888888888888888"
  # And the base..head diff renames "packages/core/src/old-severity.ts" to "packages/core/src/severity.ts"
  # And the base..head diff does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --base 1111111111111111111111111111111111111111 \
    --head 8888888888888888888888888888888888888888 \
    --changed-files "packages/core/src/severity.ts" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the base..head diff
  # Then the changed file set has TypeScript code changes
  if ! printf '%s\n' "$stdout" | grep -Fq "has_typescript_code=true"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript rename without changelog: missing TypeScript flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changed file set does not have a CHANGELOG.md change
  if ! printf '%s\n' "$stdout" | grep -Fq "has_root_changelog=false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript rename without changelog: wrong changelog flag
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript rename without changelog: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript rename without changelog: missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_typescript_deletion_without_changelog_fails_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the base commit is "1111111111111111111111111111111111111111"
  # And the head commit is "9999999999999999999999999999999999999999"
  # And the base..head diff deletes "packages/review-engine/src/legacy-parser.ts"
  # And the base..head diff does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --base 1111111111111111111111111111111111111111 \
    --head 9999999999999999999999999999999999999999 \
    --changed-files "packages/review-engine/src/legacy-parser.ts" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the base..head diff
  # Then the deleted file is classified as a TypeScript code change
  if ! printf '%s\n' "$stdout" | grep -Fq "classification=packages/review-engine/src/legacy-parser.ts:typescript-code"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript deletion without changelog: missing TypeScript classification
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript deletion without changelog: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff TypeScript deletion without changelog: missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_uses_base_head_changed_file_set_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the base commit is "1111111111111111111111111111111111111111"
  # And the head commit is "4444444444444444444444444444444444444444"
  # And the final commit changes only "README.md"
  # And the base..head diff changes these files:
  #   | path                          |
  #   | packages/config/src/schema.ts |
  #   | README.md                     |
  # And the base..head diff does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --base 1111111111111111111111111111111111111111 \
    --head 4444444444444444444444444444444444444444 \
    --final-commit-files "README.md" \
    --changed-files "packages/config/src/schema.ts,README.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the pull request
  # Then the gate uses the base..head changed file set
  if ! printf '%s\n' "$stdout" | grep -Fq "diff_scope=base..head"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff uses base-head changed file set: missing diff scope
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff uses base-head changed file set: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff uses base-head changed file set: missing failure assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_documentation_only_pass_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path            |
  #   | README.md       |
  #   | docs/install.md |
  #   | docs/adr/012.md |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files "README.md,docs/install.md,docs/adr/012.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff documentation-only pass: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate evaluates the pull request diff
  # Then the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff documentation-only pass: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the gate result is "success"
  if ! printf '%s\n' "$stdout" | grep -Fq "gate_result=success"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff documentation-only pass: missing success result
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_package_markdown_documentation_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                         |
  #   | packages/core/README.md      |
  #   | packages/config/docs/yaml.md |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files "packages/core/README.md,packages/config/docs/yaml.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the pull request diff
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff package markdown documentation: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # Then no changed file is classified as TypeScript code
  if printf '%s\n' "$stdout" | grep -Fq ":typescript-code"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff package markdown documentation: package markdown classified as TypeScript
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the changelog-check gate passes
  if ! printf '%s\n' "$stdout" | grep -Fq "changelog_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff package markdown documentation: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_documentation_only_failure_assertion_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path          |
  #   | README.md     |
  #   | docs/usage.md |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-documentation-only-assert \
    --changed-files "README.md,docs/usage.md" \
    --gate-result failure \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  # When the changelog-check gate evaluates the pull request diff
  # Then the R-01 assertion fails if the gate result is "failure"
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog documentation-only failure assertion: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "r01_assertion=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog documentation-only failure assertion: missing R-01 failure status
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  # And the failure mentions "documentation-only PR must not require CHANGELOG.md"
  if ! printf '%s\n' "$combined" | grep -Fq "documentation-only PR must not require CHANGELOG.md"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog documentation-only failure assertion: missing remediation text
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_changelog_diff_failure_message_example_path_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given pull request 53 changes these files:
  #   | path                             |
  #   | packages/config/src/schema.ts    |
  #   | apps/community-bot/src/server.ts |
  # And pull request 53 does not change "CHANGELOG.md"
  node "$SCRIPT" changelog-diff \
    --changed-files "packages/config/src/schema.ts,apps/community-bot/src/server.ts" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message example path: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  # When the changelog-check gate builds the failure message
  # Then the failure message mentions "packages/config/src/schema.ts"
  if ! printf '%s\n' "$stderr" | grep -Fq "packages/config/src/schema.ts"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message example path: missing TypeScript path
$(printf '%s\n' "$stderr" | sed 's/^/      /')"
    return
  fi

  # And the failure message mentions "CHANGELOG.md"
  if ! printf '%s\n' "$stderr" | grep -Fq "CHANGELOG.md"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ changelog diff failure message example path: missing CHANGELOG.md
$(printf '%s\n' "$stderr" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_duration_pass_case() {
  local elapsed_ms="$1"
  local reported_duration="$2"
  local end_ms stdout stderr stdout_file stderr_file ec

  end_ms=$((100000 + elapsed_ms))
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the secrets-scan job starts at monotonic time 100000 ms
  # And the secrets-scan job completes after <elapsed_ms> ms
  node "$SCRIPT" secrets-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$end_ms" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # When the secrets-scan duration budget is evaluated
  # Then the duration budget assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration pass ${elapsed_ms} ms: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration pass ${elapsed_ms} ms: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the reported secrets-scan duration is "<reported_duration>"
  if ! printf '%s\n' "$stdout" | grep -Fq "reported_duration=${reported_duration}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration pass ${elapsed_ms} ms: missing reported duration ${reported_duration}
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_duration_fail_case() {
  local elapsed_ms="$1"
  local end_ms stdout stderr stdout_file stderr_file ec combined

  end_ms=$((100000 + elapsed_ms))
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the secrets-scan job starts at monotonic time 100000 ms
  # And the secrets-scan job completes after <elapsed_ms> ms
  node "$SCRIPT" secrets-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$end_ms" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the duration budget assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration fail ${elapsed_ms} ms: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration fail ${elapsed_ms} ms: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "secrets-scan must finish in under 1 minute"
  if ! printf '%s\n' "$combined" | grep -Fq "secrets-scan must finish in under 1 minute"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration fail ${elapsed_ms} ms: missing duration failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_duration_queue_exclusion_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the secrets-scan workflow run waits in the GitHub Actions queue for 120000 ms
  # And the secrets-scan job runs for 45000 ms after the runner starts
  node "$SCRIPT" secrets-duration-budget \
    --workflow-trigger-ms 0 \
    --job-start-ms 120000 \
    --job-end-ms 165000 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration queue exclusion: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # Then the measured duration is 45000 ms
  if ! printf '%s\n' "$combined" | grep -Fq "measured_duration_ms=45000"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration queue exclusion: missing measured duration
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the duration budget assertion passes
  if ! printf '%s\n' "$combined" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration queue exclusion: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_duration_counts_only_secrets_job_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the backend-checks job completes after 45000 ms
  # And the secrets-scan job completes after 75000 ms
  node "$SCRIPT" secrets-duration-budget \
    --backend-job-start-ms 200000 \
    --backend-job-end-ms 245000 \
    --job-start-ms 100000 \
    --job-end-ms 175000 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the measured duration is 75000 ms
  if ! printf '%s\n' "$combined" | grep -Fq "measured_duration_ms=75000"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration counts only secrets job: missing measured duration
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the duration budget assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration counts only secrets job: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets duration counts only secrets job: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_forbidden_jobs_duration_pass_case() {
  local tools_ms="$1"
  local imports_ms="$2"
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the "forbidden-tools" job completes after <tools_ms> ms
  # And the "forbidden-imports" job completes after <imports_ms> ms
  node "$SCRIPT" forbidden-jobs-duration-budget \
    --forbidden-tools-ms "$tools_ms" \
    --forbidden-imports-ms "$imports_ms" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the forbidden job duration budget is evaluated
  # Then the duration budget assertion passes
  if [ "$ec" -ne 0 ] || ! printf '%s\n' "$combined" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x forbidden jobs duration pass ${tools_ms}/${imports_ms} ms: expected pass
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_forbidden_jobs_duration_fail_case() {
  local tools_ms="$1"
  local imports_ms="$2"
  local expected_message="$3"
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the "forbidden-tools" job completes after <tools_ms> ms
  # And the "forbidden-imports" job completes after <imports_ms> ms
  node "$SCRIPT" forbidden-jobs-duration-budget \
    --forbidden-tools-ms "$tools_ms" \
    --forbidden-imports-ms "$imports_ms" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the forbidden job duration budget is evaluated
  # Then the duration budget assertion fails
  if [ "$ec" -ne 1 ] || ! printf '%s\n' "$combined" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x forbidden jobs duration fail ${tools_ms}/${imports_ms} ms: expected fail
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "<expected_message>"
  if ! printf '%s\n' "$combined" | grep -Fq "$expected_message"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x forbidden jobs duration fail ${tools_ms}/${imports_ms} ms: missing ${expected_message}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_invalid_cache_state_case() {
  local stdout stderr stdout_file stderr_file ec

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" duration-budget \
    --job-start-ms 100000 \
    --job-end-ms 460000 \
    --pnpm-cache hit \
    --turbo-cache hti \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 2 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ invalid cache state: expected exit 2, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq -- "--turbo-cache must be \"hit\" or \"miss\""; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ invalid cache state: missing validation message
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_duration_pass_case() {
  local elapsed_ms reported_duration stdout stderr stdout_file stderr_file ec combined

  elapsed_ms="$1"
  reported_duration="$2"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the build-docker job starts at monotonic time 100000 ms
  # And the build-docker job completes after <elapsed_ms> ms
  # And the Docker build step uses GitHub Actions cache
  node "$SCRIPT" build-docker-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms $((100000 + elapsed_ms)) \
    --github-actions-cache enabled \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration ${elapsed_ms}: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the build-docker duration budget is evaluated
  # Then the duration budget assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration ${elapsed_ms}: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the reported build-docker duration is "<reported_duration>"
  if ! printf '%s\n' "$stdout" | grep -Fq "reported_duration=${reported_duration}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration ${elapsed_ms}: missing reported duration
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_duration_fail_case() {
  local elapsed_ms stdout stderr stdout_file stderr_file ec combined

  elapsed_ms="$1"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the build-docker job starts at monotonic time 100000 ms
  # And the build-docker job completes after <elapsed_ms> ms
  # And the Docker build step uses GitHub Actions cache
  node "$SCRIPT" build-docker-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms $((100000 + elapsed_ms)) \
    --github-actions-cache enabled \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the build-docker duration budget is evaluated
  # Then the duration budget assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration fail ${elapsed_ms}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration fail ${elapsed_ms}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must finish in under 10 minutes"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must finish in under 10 minutes"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration fail ${elapsed_ms}: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_duration_excludes_queue_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the build-docker workflow run waits in the GitHub Actions queue for 180000 ms
  # And the build-docker job runs for 540000 ms after the runner starts
  # And the Docker build step uses GitHub Actions cache
  node "$SCRIPT" build-docker-duration-budget \
    --job-start-ms 180000 \
    --job-end-ms 720000 \
    --github-actions-cache enabled \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration excludes queue: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the build-docker duration budget is evaluated
  # Then the measured duration is 540000 ms
  if ! printf '%s\n' "$stdout" | grep -Fq "measured_duration_ms=540000"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration excludes queue: missing measured duration
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the duration budget assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration excludes queue: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_duration_missing_cache_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the build-docker job completes after 300000 ms
  # And the Docker build step does not declare GitHub Actions cache
  node "$SCRIPT" build-docker-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms 400000 \
    --github-actions-cache missing \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the build-docker duration budget is evaluated
  # Then the duration budget assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration missing cache: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "duration_budget=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration missing cache: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "GitHub Actions cache must be enabled for build-docker"
  if ! printf '%s\n' "$combined" | grep -Fq "GitHub Actions cache must be enabled for build-docker"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker duration missing cache: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_verification_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the build-docker job contains a `docker/build-push-action` step
  # And the Docker build action input `push` is `false`
  # And the Docker build action input `platforms` is "linux/amd64,linux/arm64"
  # And the Docker build action input `cache-from` is "type=gha"
  # And the Docker build action input `cache-to` is "type=gha,mode=max"
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action verification: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the Docker build action configuration assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action verification: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the job is classified as a CI verification build
  if ! printf '%s\n' "$stdout" | grep -Fq "build_classification=ci-verification"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action verification: missing CI verification classification
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_push_true_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the build-docker job contains a `docker/build-push-action` step
  # And the Docker build action input `push` is `true`
  # And the Docker build action input `platforms` is "linux/amd64,linux/arm64"
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action push true: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the Docker build action configuration assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action push true: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must use push: false"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action push true: missing push failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_missing_action_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Print build context
        run: docker buildx version
YAML

  # Given the build-docker job contains no action reference starting with "docker/build-push-action@"
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing action: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the Docker build action configuration assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing action: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must use docker/build-push-action"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use docker/build-push-action"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing action: missing action failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_platform_boundary_case() {
  local platforms="$1"
  local expected_outcome="$2"
  local expected_reason="$3"
  local expected_ec=1
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if [ "$expected_outcome" = "accepted" ]; then
    expected_ec=0
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: ${platforms}
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the build-docker job contains a `docker/build-push-action` step
  # And the Docker build action input `push` is `false`
  # And the Docker build action input `platforms` is "<platforms>"
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne "$expected_ec" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action platforms ${platforms}: expected exit ${expected_ec}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the Docker build action configuration outcome is "<outcome>"
  if ! printf '%s\n' "$stdout" | grep -Fq "platform_outcome=${expected_outcome}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action platforms ${platforms}: missing ${expected_outcome} platform outcome
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the boundary reason is "<reason>"
  if ! printf '%s\n' "$combined" | grep -Fq "boundary_reason=${expected_reason}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action platforms ${platforms}: missing boundary reason ${expected_reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_missing_cache_input_case() {
  local missing_input="$1"
  local cache_from_line="          cache-from: type=gha"
  local cache_to_line="          cache-to: type=gha,mode=max"
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if [ "$missing_input" = "cache-from" ]; then
    cache_from_line=""
  fi
  if [ "$missing_input" = "cache-to" ]; then
    cache_to_line=""
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: linux/amd64,linux/arm64
${cache_from_line}
${cache_to_line}
YAML

  # Given the build-docker job contains a `docker/build-push-action` step
  # And the Docker build action input `push` is `false`
  # And the Docker build action input `platforms` is "linux/amd64,linux/arm64"
  # And the Docker build action input `<missing_input>` is absent
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing ${missing_input}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the Docker build action configuration assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing ${missing_input}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "Docker build must use GitHub Actions cache"
  if ! printf '%s\n' "$combined" | grep -Fq "Docker build must use GitHub Actions cache"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action missing ${missing_input}: missing cache failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_env_inputs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        env:
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the Docker build action has matching names outside the `with` inputs
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action env inputs: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then only the `with` inputs are considered
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action env inputs: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And matching names under `env` do not satisfy the required push input
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action env inputs: missing with-only failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_flow_with_mapping_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: { push: false, platforms: "linux/amd64,linux/arm64", cache-from: type=gha, cache-to: "type=gha,mode=max" }
YAML

  # Given the Docker build action declares required inputs with a flow-style mapping
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action flow with mapping: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the flow-style `with` inputs are accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action flow with mapping: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_build_job_anchor_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker: &base_job
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the build-docker job header uses a YAML anchor
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored job: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the anchored build-docker job is accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored job: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_with_block_anchor_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: &docker_inputs
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the Docker build action `with` block uses a YAML anchor
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored with block: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the anchored `with` block inputs are accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored with block: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_anchored_flow_with_mapping_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: &docker_inputs { push: false, platforms: "linux/amd64,linux/arm64", cache-from: type=gha, cache-to: "type=gha,mode=max" }
YAML

  # Given the Docker build action declares a flow-style `with` mapping with an anchor
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored flow with mapping: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the anchored flow-style `with` inputs are accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action anchored flow with mapping: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_with_alias_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build first Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: &docker_inputs
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build second Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: *docker_inputs
YAML

  # Given a later Docker build action reuses an anchored `with` mapping
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action with alias: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When every Docker build action step is evaluated
  # Then aliased `with` inputs are resolved and accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action with alias: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_with_redefined_alias_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build first Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: &docker_inputs
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Redefine shared inputs
        uses: actions/cache@0400d5f644dc74513175e3cd8d07132dd4860809
        with: &docker_inputs
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build second Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: *docker_inputs
YAML

  # Given an alias references a redefined `with` anchor closer to the Docker step
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action redefined alias: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When every Docker build action step is evaluated
  # Then the alias resolves to the nearest preceding anchor and rejects push
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action redefined alias: missing nearest-anchor failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_uses_current_alias_step_occurrence_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - name: Define shared inputs
        uses: actions/cache@0400d5f644dc74513175e3cd8d07132dd4860809
        with: &docker_inputs
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: *docker_inputs

  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Redefine shared inputs
        uses: actions/cache@0400d5f644dc74513175e3cd8d07132dd4860809
        with: &docker_inputs
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: *docker_inputs
YAML

  # Given an identical alias Docker step exists before the build-docker job
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action current alias step occurrence: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the build-docker alias is resolved
  # Then it uses the current step occurrence rather than the earlier identical step
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action current alias step occurrence: missing current-anchor failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_multiline_platforms_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: |
            linux/amd64
            linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the Docker build action declares required platforms with a block scalar
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action multiline platforms: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then newline-delimited required platforms are accepted
  if ! printf '%s\n' "$stdout" | grep -Fq "platform_outcome=accepted"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action multiline platforms: missing accepted platform outcome
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the Docker build action configuration assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action multiline platforms: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_rejects_folded_platforms_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: >
            linux/amd64
            linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the Docker build action declares platforms with a folded block scalar
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action folded platforms: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then folded platforms are not accepted as newline-delimited entries
  if ! printf '%s\n' "$stdout" | grep -Fq "platform_outcome=rejected"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action folded platforms: missing rejected platform outcome
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the Docker build action configuration assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action folded platforms: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_run_block_fake_step_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Mention Docker action in shell text
        run: |
          cat <<'EOF'
          - uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
            with:
              push: false
              platforms: linux/amd64,linux/arm64
              cache-from: type=gha
              cache-to: type=gha,mode=max
          EOF
YAML

  # Given the Docker action only appears inside a run block
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action fake run step: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then shell text is not treated as a workflow step
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use docker/build-push-action"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action fake run step: missing real-step failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_fake_job_markers_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - name: Mention build-docker in shell text
        run: |
          build-docker:
            steps:
              - uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
                with:
                  push: false
                  platforms: linux/amd64,linux/arm64
                  cache-from: type=gha
                  cache-to: type=gha,mode=max
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Real Docker build step pushes
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given an earlier job shell script contains fake build-docker markers
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action fake job markers: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the real build-docker job is selected
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action fake job markers: missing real-job failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_nested_build_job_key_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  prepare:
    runs-on: ubuntu-latest
    env:
      build-docker:
        steps:
          - uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
            with:
              push: false
              platforms: linux/amd64,linux/arm64
              cache-from: type=gha
              cache-to: type=gha,mode=max
    steps:
      - run: echo prepare
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Real Docker build step pushes
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given a nested mapping under another job uses the build-docker key name
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested build job key: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then only the direct jobs.build-docker mapping is selected
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested build job key: missing direct-job failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_nested_steps_key_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    env:
      steps:
        - uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
          with:
            push: false
            platforms: linux/amd64,linux/arm64
            cache-from: type=gha
            cache-to: type=gha,mode=max
    steps:
      - name: Real Docker build step pushes
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given a nested mapping under build-docker uses the steps key name
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested steps key: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then only the direct jobs.build-docker.steps mapping is selected
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested steps key: missing direct-steps failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_variable_indent_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
    build-docker:
        runs-on: ubuntu-latest
        steps:
            - name: Build Community bot image
              uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
              with:
                  push: false
                  platforms: linux/amd64,linux/arm64
                  cache-from: type=gha
                  cache-to: type=gha,mode=max
YAML

  # Given the workflow uses a valid indentation width wider than two spaces
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action variable indent: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then direct child lookup accepts the workflow indentation width
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action variable indent: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_indented_root_jobs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
  name: ci
  jobs:
    build-docker:
      runs-on: ubuntu-latest
      steps:
        - name: Build Community bot image
          uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
          with:
            push: false
            platforms: linux/amd64,linux/arm64
            cache-from: type=gha
            cache-to: type=gha,mode=max
YAML

  # Given the workflow indents every root-level YAML key
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action indented root jobs: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action configuration is evaluated
  # Then the root jobs mapping is found at the document root indentation
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action indented root jobs: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_inline_with_anchor_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - with: &docker_inputs
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with: *docker_inputs
YAML

  # Given the anchored `with` mapping is declared on an inline list item
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action inline with anchor: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When every Docker build action step is evaluated
  # Then the inline anchored `with` mapping is resolved
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action inline with anchor: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_with_comment_before_inputs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
            # Docker inputs stay below on the mapping's child indent.
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given the first non-empty line under `with` is an over-indented comment
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action comment before inputs: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action inputs are evaluated
  # Then comment indentation does not define the input child indent
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action comment before inputs: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_first_line_with_block_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - with:
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
        name: Build Community bot image
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
YAML

  # Given the Docker build action step starts with the `with` block
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action first-line with block: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action inputs are evaluated
  # Then the first-line `with` block is read
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_build_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action first-line with block: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_rejects_later_push_step_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Compliant image build
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: false
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Later image push
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given a later Docker build action step attempts to push
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action later push step: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When every Docker build action step is evaluated
  # Then the later push step is rejected
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action later push step: missing push failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_nested_with_scalar_inputs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Spoof inputs inside another input scalar
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          context: |
            push: false
            cache-from: type=gha
            cache-to: type=gha,mode=max
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given matching input names appear inside another input's block scalar
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested with scalar inputs: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action inputs are evaluated
  # Then nested scalar text is not treated as a direct `with` input
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested with scalar inputs: missing direct-input failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_build_action_ignores_nested_with_block_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Spoof a with block inside another scalar
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        env:
          DUMMY: |
            with:
              push: false
              platforms: linux/amd64,linux/arm64
              cache-from: type=gha
              cache-to: type=gha,mode=max
        with:
          push: true
          platforms: linux/amd64,linux/arm64
          cache-from: type=gha
          cache-to: type=gha,mode=max
YAML

  # Given a fake `with` block appears inside another step property scalar
  node "$SCRIPT" docker-build-action --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested with block: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker build action inputs are evaluated
  # Then only a direct step-level `with` block is considered
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use push: false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker build action nested with block: missing direct-with failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_setup_action_pinning_sha_pass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Set up QEMU
        uses: docker/setup-qemu-action@0123456789abcdef0123456789abcdef01234567
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@89abcdef0123456789abcdef0123456789abcdef
YAML

  # Given the build-docker job contains the action reference "docker/setup-qemu-action@0123456789abcdef0123456789abcdef01234567"
  # And the build-docker job contains the action reference "docker/setup-buildx-action@89abcdef0123456789abcdef0123456789abcdef"
  node "$SCRIPT" docker-setup-action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action pinning SHA pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker setup action pinning rule is evaluated
  # Then the Docker setup action pinning assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_setup_action_pinning=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action pinning SHA pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And no moving Docker setup action reference is reported
  if printf '%s\n' "$stdout" | grep -Fq "moving_reference="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action pinning SHA pass: unexpected moving reference
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_setup_action_pinning_moving_ref_case() {
  local action_ref="$1"
  local other_action_ref="docker/setup-buildx-action@89abcdef0123456789abcdef0123456789abcdef"
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if printf '%s\n' "$action_ref" | grep -Fq "docker/setup-buildx-action@"; then
    other_action_ref="docker/setup-qemu-action@0123456789abcdef0123456789abcdef01234567"
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Docker setup action under test
        uses: ${action_ref}
      - name: Other required Docker setup action
        uses: ${other_action_ref}
YAML

  # Given the build-docker job contains the action reference "<action_ref>"
  node "$SCRIPT" docker-setup-action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action moving ref ${action_ref}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker setup action pinning rule is evaluated
  # Then the Docker setup action pinning assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_setup_action_pinning=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action moving ref ${action_ref}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "<action_ref>"
  if ! printf '%s\n' "$combined" | grep -Fq "$action_ref"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action moving ref ${action_ref}: missing action reference
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "Docker setup actions must be pinned to a full commit SHA"
  if ! printf '%s\n' "$combined" | grep -Fq "Docker setup actions must be pinned to a full commit SHA"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action moving ref ${action_ref}: missing pinning failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_setup_action_pinning_missing_action_case() {
  local present_action="$1"
  local missing_action="$2"
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Present Docker setup action
        uses: ${present_action}@0123456789abcdef0123456789abcdef01234567
YAML

  # Given the build-docker job contains the action reference "<present_action>@0123456789abcdef0123456789abcdef01234567"
  # And the build-docker job contains no action reference starting with "<missing_action>@"
  node "$SCRIPT" docker-setup-action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action missing ${missing_action}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker setup action pinning rule is evaluated
  # Then the Docker setup action pinning assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_setup_action_pinning=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action missing ${missing_action}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must use <missing_action>"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use ${missing_action}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action missing ${missing_action}: missing missing-action failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_setup_action_pinning_sha_boundary_case() {
  local sha_ref="$1"
  local expected_outcome="$2"
  local expected_reason="$3"
  local expected_exit=1
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if [ "$expected_outcome" = "accepted" ]; then
    expected_exit=0
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Set up QEMU
        uses: docker/setup-qemu-action@0123456789abcdef0123456789abcdef01234567
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@${sha_ref}
YAML

  # Given the build-docker job contains the action reference "docker/setup-buildx-action@<sha_ref>"
  node "$SCRIPT" docker-setup-action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne "$expected_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action SHA boundary ${sha_ref}: expected exit ${expected_exit}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker setup action pinning rule is evaluated
  # Then the Docker setup action pinning assertion outcome is "<outcome>"
  if ! printf '%s\n' "$stdout" | grep -Fq "pinning_outcome=${expected_outcome}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action SHA boundary ${sha_ref}: missing expected outcome ${expected_outcome}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the boundary reason is "<reason>"
  if ! printf '%s\n' "$stdout" | grep -Fq "boundary_reason=${expected_reason}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action SHA boundary ${sha_ref}: missing boundary reason ${expected_reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_docker_setup_action_pinning_invalid_sha_class_case() {
  local sha_ref="$1"
  local expected_reason="$2"
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Set up QEMU
        uses: docker/setup-qemu-action@${sha_ref}
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@89abcdef0123456789abcdef0123456789abcdef
YAML

  # Given the build-docker job contains the action reference "docker/setup-qemu-action@<sha_ref>"
  node "$SCRIPT" docker-setup-action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action invalid SHA class ${sha_ref}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Docker setup action pinning rule is evaluated
  # Then the Docker setup action pinning assertion fails
  if ! printf '%s\n' "$stdout" | grep -Fq "docker_setup_action_pinning=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action invalid SHA class ${sha_ref}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "<reason>"
  if ! printf '%s\n' "$combined" | grep -Fq "$expected_reason"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x docker setup action invalid SHA class ${sha_ref}: missing failure reason ${expected_reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_required_gates_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    needs:
      - backend-checks
      - supply-chain
      - secrets-scan
      - forbidden-tools
      - forbidden-imports
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  # Given the build-docker job has these `needs` entries:
  #   | job               |
  #   | backend-checks    |
  #   | supply-chain      |
  #   | secrets-scan      |
  #   | forbidden-tools   |
  #   | forbidden-imports |
  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker required gates pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the build-docker dependency rule is evaluated
  # Then the build-docker dependency assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_needs=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker required gates pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And no required upstream job is reported missing
  if printf '%s\n' "$stdout" | grep -Fq "missing_required_job="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker required gates pass: unexpected missing required job
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_inline_gates_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    needs: [backend-checks, supply-chain, secrets-scan, forbidden-tools, forbidden-imports]
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker inline needs pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_needs=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker inline needs pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "missing_required_job="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker inline needs pass: unexpected missing required job
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_multiline_flow_gates_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    needs: [
      backend-checks,
      supply-chain,
      secrets-scan,
      forbidden-tools,
      forbidden-imports
    ]
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker multiline flow needs pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_needs=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker multiline flow needs pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "missing_required_job="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker multiline flow needs pass: unexpected missing required job
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_scalar_gate_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    needs: backend-checks
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scalar needs fail: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "missing_required_job=backend-checks"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scalar needs fail: present scalar need was reported missing
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "missing_required_job=supply-chain"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scalar needs fail: missing required job not reported
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_missing_required_gate_case() {
  local missing_job workflow_file stdout stderr stdout_file stderr_file ec combined job

  for missing_job in \
    "backend-checks" \
    "supply-chain" \
    "secrets-scan" \
    "forbidden-tools" \
    "forbidden-imports"; do
    workflow_file=$(mktemp)
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    {
      printf 'name: ci\n'
      printf 'jobs:\n'
      printf '  build-docker:\n'
      printf '    needs:\n'
      for job in \
        "backend-checks" \
        "supply-chain" \
        "secrets-scan" \
        "forbidden-tools" \
        "forbidden-imports"; do
        if [ "$job" != "$missing_job" ]; then
          printf '      - %s\n' "$job"
        fi
      done
      printf '    runs-on: ubuntu-latest\n'
      printf '    steps:\n'
      printf '      - run: echo build\n'
    } >"$workflow_file"

    # Given the build-docker job needs every required upstream job except "<missing_job>"
    node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    rm -f "$workflow_file" "$stdout_file" "$stderr_file"
    combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

    # When the build-docker dependency rule is evaluated
    # Then the build-docker dependency assertion fails
    if [ "$ec" -eq 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker missing required gate ${missing_job}: expected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      continue
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_needs=fail"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker missing required gate ${missing_job}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
      continue
    fi

    # And the failure mentions "build-docker must need <missing_job>"
    if ! printf '%s\n' "$combined" | grep -Fq "build-docker must need ${missing_job}"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker missing required gate ${missing_job}: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
      continue
    fi

    PASS=$((PASS + 1))
  done
}

run_build_docker_needs_missing_needs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - run: echo backend
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  # Given the build-docker job has no `needs` entries
  # And the backend-checks job is still running
  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the build-docker dependency rule is evaluated
  # Then the build-docker dependency assertion fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker missing needs: expected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must wait for required gates"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must wait for required gates"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker missing needs: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_needs_anchored_job_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker: &base_job
    needs:
      - backend-checks
      - supply-chain
      - secrets-scan
      - forbidden-tools
      - forbidden-imports
    runs-on: ubuntu-latest
    steps:
      - run: echo build
YAML

  # Given the build-docker job header uses a YAML anchor
  # And the build-docker job has all required `needs` entries
  node "$SCRIPT" build-docker-needs --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the build-docker dependency rule is evaluated
  # Then the anchored build-docker job is accepted
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker needs anchored job: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_needs=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker needs anchored job: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_scheduler_failed_gate_case() {
  local stdout stderr stdout_file stderr_file ec combined

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the backend-checks job succeeds
  # And the supply-chain job succeeds
  # And the secrets-scan job fails
  # And the forbidden-tools job succeeds
  # And the forbidden-imports job succeeds
  node "$SCRIPT" build-docker-scheduler \
    --backend-checks success \
    --supply-chain success \
    --secrets-scan failure \
    --forbidden-tools success \
    --forbidden-imports success \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scheduler failed gate: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the workflow scheduler evaluates the build-docker job dependencies
  # Then the build-docker job is not eligible to run
  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_eligible=false"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scheduler failed gate: missing ineligible result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the build-docker job result is "skipped"
  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_result=skipped"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x build-docker scheduler failed gate: missing skipped result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_build_docker_scheduler_non_success_gate_case() {
  local state stdout stderr stdout_file stderr_file ec combined

  for state in cancelled skipped; do
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    node "$SCRIPT" build-docker-scheduler \
      --backend-checks success \
      --supply-chain success \
      --secrets-scan "$state" \
      --forbidden-tools success \
      --forbidden-imports success \
      >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    rm -f "$stdout_file" "$stderr_file"
    combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

    if [ "$ec" -ne 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker scheduler ${state} gate: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      continue
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_result=skipped"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker scheduler ${state} gate: missing skipped result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
      continue
    fi

    if ! printf '%s\n' "$stdout" | grep -Fq "failed_upstream_job=secrets-scan"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x build-docker scheduler ${state} gate: missing upstream evidence
$(printf '%s\n' "$combined" | sed 's/^/        /')"
      continue
    fi

    PASS=$((PASS + 1))
  done
}

run_action_pinning_sha_pass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given ".github/workflows/ci.yml" contains these action references:
  #   | action_ref                                                       |
  #   | actions/checkout@3df4ab11eba7bda6032a0b82a6bb43b11571feac        |
  #   | pnpm/action-setup@d7766e4727e5c7cdb6066c497694f72f1b5945ad       |
  #   | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020      |
  #   | github/codeql-action/init@0b7f35c6c6b164fc7d5af9edc7ed1e90e6e1a5bf |
  {
    printf 'name: ci\n'
    printf 'jobs:\n'
    printf '  backend-checks:\n'
    printf '    steps:\n'
    printf '      - uses: actions/checkout@3df4ab11eba7bda6032a0b82a6bb43b11571feac\n'
    printf '      - uses: pnpm/action-setup@d7766e4727e5c7cdb6066c497694f72f1b5945ad\n'
    printf '      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n'
    printf '      - uses: github/codeql-action/init@0b7f35c6c6b164fc7d5af9edc7ed1e90e6e1a5bf\n'
  } >"$workflow_file"

  # When the workflow action pinning rule is evaluated
  node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # Then the action pinning assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "action_pinning=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA pass: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And no external action reference is reported as moving
  if printf '%s\n' "$stdout" | grep -Fq "moving_reference="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA pass: unexpected moving reference
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_sha_pass_case() {
  local action_ref workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  action_ref="gitleaks/gitleaks-action@0123456789abcdef0123456789abcdef01234567"
  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3df4ab11eba7bda6032a0b82a6bb43b11571feac
        with:
          fetch-depth: 0
      - uses: ${action_ref}
YAML

  cat >"$metadata_file" <<JSON
{
  "pins": [
    {
      "action_ref": "${action_ref}",
      "source_release_line": "v2"
    }
  ]
}
JSON

  # Given the secrets-scan job contains the Gitleaks action pinned by full commit SHA
  # And the action pin metadata records source release line "v2"
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "gitleaks_action=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And no moving Gitleaks action reference is reported
  if printf '%s\n' "$stdout" | grep -Fq "moving_reference="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA pass: unexpected moving reference
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_missing_action_case() {
  local workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3df4ab11eba7bda6032a0b82a6bb43b11571feac
        with:
          fetch-depth: 0
YAML

  cat >"$metadata_file" <<'JSON'
{
  "pins": []
}
JSON

  # Given the secrets-scan job contains no Gitleaks action reference
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning missing action: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "gitleaks_action=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning missing action: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the required Gitleaks action repository
  if ! printf '%s\n' "$combined" | grep -Fq "secrets-scan must run gitleaks/gitleaks-action"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning missing action: missing failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_moving_v2_case() {
  local action_ref workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  action_ref="gitleaks/gitleaks-action@v2"
  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: ${action_ref}
YAML

  cat >"$metadata_file" <<'JSON'
{
  "pins": []
}
JSON

  # Given the secrets-scan job contains the moving Gitleaks v2 tag
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning moving v2: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "$action_ref"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning moving v2: missing action reference
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the full commit SHA requirement
  if ! printf '%s\n' "$combined" | grep -Fq "Gitleaks action must be pinned to a full commit SHA"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning moving v2: missing pinning failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_sha_boundary_example() {
  local sha_ref="$1"
  local outcome="$2"
  local reason="$3"
  local action_ref workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  action_ref="gitleaks/gitleaks-action@${sha_ref}"
  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: ${action_ref}
YAML

  cat >"$metadata_file" <<JSON
{
  "pins": [
    {
      "action_ref": "${action_ref}",
      "source_release_line": "v2"
    }
  ]
}
JSON

  # Given the secrets-scan job contains the Gitleaks action reference with SHA boundary length
  # And the action pin metadata records source release line "v2"
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion outcome is "<outcome>"
  if [ "$outcome" = "accepted" ] && [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA boundary ${sha_ref}: expected accepted exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if [ "$outcome" = "rejected" ] && [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA boundary ${sha_ref}: expected rejected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the boundary reason is "<reason>"
  if ! printf '%s\n' "$combined" | grep -Fq "$reason"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning SHA boundary ${sha_ref}: missing boundary reason ${reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_sha_boundary_case() {
  run_gitleaks_action_pinning_sha_boundary_example \
    "123456789012345678901234567890123456789" \
    "rejected" \
    "39 hexadecimal characters is too short"
  run_gitleaks_action_pinning_sha_boundary_example \
    "1234567890123456789012345678901234567890" \
    "accepted" \
    "40 hexadecimal characters is exactly valid"
  run_gitleaks_action_pinning_sha_boundary_example \
    "12345678901234567890123456789012345678901" \
    "rejected" \
    "41 hexadecimal characters is too long"
}

run_gitleaks_action_pinning_invalid_sha_class_example() {
  local sha_ref="$1"
  local reason="$2"
  local action_ref workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  action_ref="gitleaks/gitleaks-action@${sha_ref}"
  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: ${action_ref}
YAML

  cat >"$metadata_file" <<JSON
{
  "pins": [
    {
      "action_ref": "${action_ref}",
      "source_release_line": "v2"
    }
  ]
}
JSON

  # Given the secrets-scan job contains a forty-character non-lowercase-hex SHA
  # And the action pin metadata records source release line "v2"
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning invalid SHA ${sha_ref}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "<reason>"
  if ! printf '%s\n' "$combined" | grep -Fq "$reason"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning invalid SHA ${sha_ref}: missing failure reason ${reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_gitleaks_action_pinning_invalid_sha_class_case() {
  run_gitleaks_action_pinning_invalid_sha_class_example \
    "123456789012345678901234567890123456789A" \
    "SHA must use lowercase hexadecimal characters"
  run_gitleaks_action_pinning_invalid_sha_class_example \
    "123456789012345678901234567890123456789g" \
    "SHA must use lowercase hexadecimal characters"
  run_gitleaks_action_pinning_invalid_sha_class_example \
    "123456789012345678901234567890123456789_" \
    "SHA must use lowercase hexadecimal characters"
}

run_gitleaks_action_pinning_non_v2_provenance_case() {
  local action_ref workflow_file metadata_file stdout stderr stdout_file stderr_file ec combined

  action_ref="gitleaks/gitleaks-action@0123456789abcdef0123456789abcdef01234567"
  workflow_file=$(mktemp)
  metadata_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: ${action_ref}
YAML

  cat >"$metadata_file" <<JSON
{
  "pins": [
    {
      "action_ref": "${action_ref}",
      "source_release_line": "main"
    }
  ]
}
JSON

  # Given the secrets-scan job contains a pinned Gitleaks action
  # And the action pin metadata records source release line "main"
  node "$SCRIPT" gitleaks-action-pinning \
    --workflow "$workflow_file" \
    --metadata "$metadata_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$metadata_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the Gitleaks action assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning non-v2 provenance: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the v2 release-line requirement
  if ! printf '%s\n' "$combined" | grep -Fq "Gitleaks pin must originate from the v2 release line"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x gitleaks action pinning non-v2 provenance: missing provenance failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_direct_call_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh
YAML

  # Given the secrets-scan job contains a shell step named "Secret filename and API key patterns"
  # And that step runs "scripts/no-secrets.sh"
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse direct call: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "no_secrets_reuse=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse direct call: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "shared_script=scripts/no-secrets.sh"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse direct call: missing shared script path
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the workflow does not duplicate the script pattern list inline
  if ! printf '%s\n' "$stdout" | grep -Fq "inline_pattern_list=absent"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse direct call: missing inline pattern absence
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_block_scalar_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          bash scripts/no-secrets.sh
YAML

  # Given the secrets-scan job contains a shell step named "Secret filename and API key patterns"
  # And that step invokes "scripts/no-secrets.sh" from a block-scalar run command
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse block scalar: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "no_secrets_reuse=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse block scalar: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_comment_bypass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: echo ok # scripts/no-secrets.sh
YAML

  # Given the secrets-scan job contains a non-executing comment mentioning "scripts/no-secrets.sh"
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse comment bypass: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse comment bypass: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_inline_patterns_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: rg -n "OPENAI_API_KEY|ANTHROPIC_API_KEY" .
YAML

  # Given the secrets-scan job duplicates secret patterns inline instead of running the shared guard
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails and reports the required shared script
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "inline_pattern_list=present"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns: missing inline pattern marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "CI must reuse the shared secret guard"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns: missing reuse failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "scripts/no-secrets.sh"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns: missing shared script path
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_masked_failure_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh || true
YAML

  # Given the shared guard failure would be masked by the shell command
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails because secrets-scan would not fail
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse masked failure: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse masked failure: missing failure propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "CI must fail when scripts/no-secrets.sh fails"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse masked failure: missing propagation failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_compact_masked_failure_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh ||true
YAML

  # Given the shared guard failure would be masked by a compact shell operator
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails because secrets-scan would not fail
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse compact masked failure: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse compact masked failure: missing failure propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_continue_on_error_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        continue-on-error: true
        run: scripts/no-secrets.sh
YAML

  # Given the shared guard step allows GitHub Actions to continue after failure
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails because secrets-scan would not fail
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error: missing failure propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "CI must fail when scripts/no-secrets.sh fails"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error: missing propagation failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_rethrow_failure_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh || exit 1
YAML

  # Given the shared guard failure is explicitly re-thrown by the shell command
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes because secrets-scan still fails
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse rethrow failure: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse rethrow failure: missing pass propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_quoted_status_rethrow_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh || exit "$?"
YAML

  # Given the shared guard failure is re-thrown with a quoted shell status
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes because secrets-scan still fails
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse quoted status rethrow: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse quoted status rethrow: missing pass propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_continue_on_error_expression_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        continue-on-error: ${{ true }}
        run: scripts/no-secrets.sh
YAML

  # Given the shared guard step uses an expression that enables continue-on-error
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails because secrets-scan would not fail
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error expression: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error expression: missing failure propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_continue_on_error_false_expression_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        continue-on-error: ${{false}}
        run: scripts/no-secrets.sh
YAML

  # Given the shared guard step explicitly disables continue-on-error with a compact expression
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes because secrets-scan still fails
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error false expression: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse continue-on-error false expression: missing pass propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_inline_patterns_with_script_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          scripts/no-secrets.sh
          rg -n "OPENAI_API_KEY|ANTHROPIC_API_KEY" .
YAML

  # Given the shared guard failure propagates but the workflow still duplicates patterns inline
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion reports the known propagation status
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns with script: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_failure_propagation=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns with script: missing pass propagation marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "inline_pattern_list=present"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse inline patterns with script: missing inline pattern marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_missing_script_file_case() {
  local repo_root workflow_file stdout stderr stdout_file stderr_file ec combined

  repo_root=$(mktemp -d)
  workflow_file="$repo_root/.github/workflows/ci.yml"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  mkdir -p "$repo_root/.github/workflows"

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh
YAML

  # Given the workflow runs the shared guard but the repository does not contain it
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    --repo-root "$repo_root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$repo_root"
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails as a configuration error
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse missing script file: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_file=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse missing script file: missing script file marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "scripts/no-secrets.sh is required"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse missing script file: missing required script message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_parent_traversal_script_file_case() {
  local sandbox repo_root outside_root workflow_file stdout stderr stdout_file stderr_file ec combined

  sandbox=$(mktemp -d)
  repo_root="$sandbox/repo"
  outside_root="$sandbox/outside"
  workflow_file="$repo_root/.github/workflows/ci.yml"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  mkdir -p "$repo_root/.github/workflows" "$outside_root"
  printf '#!/bin/sh\nexit 0\n' >"$outside_root/no-secrets.sh"

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: ../outside/no-secrets.sh
YAML

  # Given a parent traversal path resolves to a file outside the repository
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path ../outside/no-secrets.sh \
    --repo-root "$repo_root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$sandbox"
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion treats it as a missing repo script
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse parent traversal script file: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_file=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse parent traversal script file: missing script file marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "../outside/no-secrets.sh is required"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse parent traversal script file: missing required script message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_absolute_script_file_case() {
  local sandbox repo_root outside_root script_file workflow_file stdout stderr stdout_file stderr_file ec combined

  sandbox=$(mktemp -d)
  repo_root="$sandbox/repo"
  outside_root="$sandbox/outside"
  script_file="$outside_root/no-secrets.sh"
  workflow_file="$repo_root/.github/workflows/ci.yml"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  mkdir -p "$repo_root/.github/workflows" "$outside_root"
  printf '#!/bin/sh\nexit 0\n' >"$script_file"

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: $script_file
YAML

  # Given an absolute path points to a file outside the repository
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path "$script_file" \
    --repo-root "$repo_root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$sandbox"
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion treats it as a missing repo script
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse absolute script file: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_file=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse absolute script file: missing script file marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "$script_file is required"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse absolute script file: missing required script message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_symlink_script_file_case() {
  local sandbox repo_root outside_root script_file workflow_file stdout stderr stdout_file stderr_file ec combined

  sandbox=$(mktemp -d)
  repo_root="$sandbox/repo"
  outside_root="$sandbox/outside"
  script_file="$outside_root/no-secrets.sh"
  workflow_file="$repo_root/.github/workflows/ci.yml"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  mkdir -p "$repo_root/.github/workflows" "$repo_root/scripts" "$outside_root"
  printf '#!/bin/sh\nexit 0\n' >"$script_file"
  ln -s "$script_file" "$repo_root/scripts/no-secrets.sh"

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: scripts/no-secrets.sh
YAML

  # Given the repo-local script path is a symlink to a file outside the repository
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    --repo-root "$repo_root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$sandbox"
  rm -f "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion treats it as a missing repo script
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse symlink script file: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "script_file=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse symlink script file: missing script file marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "scripts/no-secrets.sh is required"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse symlink script file: missing required script message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_fake_step_in_run_block_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: unrelated shell step
        run: |
          cat <<'EOF'
          - name: Secret filename and API key patterns
            run: scripts/no-secrets.sh
          EOF
YAML

  # Given a run block contains fake YAML text mentioning the guard step and script
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse fake step in run block: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse fake step in run block: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_folded_scalar_bypass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: >
          echo ok
          scripts/no-secrets.sh
YAML

  # Given a folded run scalar mentions "scripts/no-secrets.sh" after a different command
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse folded scalar bypass: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse folded scalar bypass: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_nested_run_field_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567
        with:
          run: scripts/no-secrets.sh
YAML

  # Given a non-shell action step contains a nested "run" input mentioning the guard script
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails because the script is not executed
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse nested run field: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse nested run field: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_run_field_in_block_body_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          cat <<'EOF'
          run: scripts/no-secrets.sh
          EOF
YAML

  # Given the named guard step contains non-executing heredoc text with a run field
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse run field in block body: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse run field in block body: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_script_path_in_heredoc_body_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          cat <<'EOF'
          scripts/no-secrets.sh
          EOF
YAML

  # Given the named guard step contains non-executing heredoc text with the script path
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse script path in heredoc body: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse script path in heredoc body: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_special_heredoc_delimiter_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          cat <<'EOF!'
          scripts/no-secrets.sh
          EOF!
YAML

  # Given a heredoc uses a shell delimiter containing punctuation
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse special heredoc delimiter: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse special heredoc delimiter: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_line_continuation_bypass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: |
          echo ok \
          scripts/no-secrets.sh
YAML

  # Given the shared script path appears only on a line-continued shell argument
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse line continuation bypass: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse line continuation bypass: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_folded_scalar_paragraph_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: >
          echo ok

          scripts/no-secrets.sh
YAML

  # Given a folded run scalar preserves a blank line before the shared script command
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse folded scalar paragraph: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse folded scalar paragraph: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_no_secrets_reuse_shell_option_wrapper_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Secret filename and API key patterns
        run: bash -euxo pipefail scripts/no-secrets.sh
YAML

  # Given the guard step runs the shared script through bash with grouped shell options
  node "$SCRIPT" secrets-no-secrets-reuse \
    --workflow "$workflow_file" \
    --script-path scripts/no-secrets.sh \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the no-secrets reuse assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse shell option wrapper: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "no_secrets_reuse=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets no-secrets reuse shell option wrapper: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_action_pinning_no_external_refs_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given ".github/workflows/ci.yml" contains no `uses:` entries
  {
    printf 'name: ci\n'
    printf 'jobs:\n'
    printf '  backend-checks:\n'
    printf '    steps:\n'
    printf '      - run: pnpm exec oxlint . --max-warnings=0\n'
  } >"$workflow_file"

  # When the workflow action pinning rule is evaluated
  node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning no external refs: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # Then the action pinning assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "action_pinning=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning no external refs: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And no external action reference is reported as moving
  if printf '%s\n' "$stdout" | grep -Fq "moving_reference="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning no external refs: unexpected moving reference
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_action_pinning_moving_refs_case() {
  local action_ref workflow_file stdout stderr stdout_file stderr_file ec

  for action_ref in \
    "actions/checkout@v4" \
    "pnpm/action-setup@v4" \
    "docker/setup-buildx-action@master" \
    "actions/upload-artifact@3df4ab1"; do
    workflow_file=$(mktemp)
    stdout_file=$(mktemp)
    stderr_file=$(mktemp)

    # Given ".github/workflows/ci.yml" contains the action reference "<action_ref>"
    {
      printf 'name: ci\n'
      printf 'jobs:\n'
      printf '  backend-checks:\n'
      printf '    steps:\n'
      printf '      - uses: %s\n' "$action_ref"
    } >"$workflow_file"

    # When the workflow action pinning rule is evaluated
    node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    stdout=$(cat "$stdout_file" 2>/dev/null || true)
    stderr=$(cat "$stderr_file" 2>/dev/null || true)
    rm -f "$workflow_file" "$stdout_file" "$stderr_file"

    # Then the action pinning assertion fails
    if [ "$ec" -eq 0 ]; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x action pinning moving ref ${action_ref}: expected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      continue
    fi

    # And the failure mentions "<action_ref>"
    if ! printf '%s\n%s\n' "$stdout" "$stderr" | grep -Fq "$action_ref"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x action pinning moving ref ${action_ref}: missing action reference in failure
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      continue
    fi

    # And the failure mentions "external actions must be pinned to a full commit SHA"
    if ! printf '%s\n%s\n' "$stdout" "$stderr" | grep -Fq "external actions must be pinned to a full commit SHA"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  x action pinning moving ref ${action_ref}: missing pinning failure message
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      continue
    fi

    PASS=$((PASS + 1))
  done
}

run_action_pinning_sha_boundary_example() {
  local sha_ref="$1"
  local outcome="$2"
  local reason="$3"
  local action_ref workflow_file stdout stderr stdout_file stderr_file ec combined

  action_ref="actions/checkout@${sha_ref}"
  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given ".github/workflows/ci.yml" contains the action reference "actions/checkout@<sha_ref>"
  {
    printf 'name: ci\n'
    printf 'jobs:\n'
    printf '  backend-checks:\n'
    printf '    steps:\n'
    printf '      - uses: %s\n' "$action_ref"
  } >"$workflow_file"

  # When the workflow action pinning rule is evaluated
  node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the action pinning assertion outcome is "<outcome>"
  if [ "$outcome" = "accepted" ] && [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA boundary ${sha_ref}: expected accepted exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if [ "$outcome" = "rejected" ] && [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA boundary ${sha_ref}: expected rejected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the boundary reason is "<reason>"
  if ! printf '%s\n' "$combined" | grep -Fq "$reason"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning SHA boundary ${sha_ref}: missing boundary reason ${reason}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_action_pinning_sha_boundary_case() {
  run_action_pinning_sha_boundary_example \
    "123456789012345678901234567890123456789" \
    "rejected" \
    "39 hexadecimal characters is too short"
  run_action_pinning_sha_boundary_example \
    "1234567890123456789012345678901234567890" \
    "accepted" \
    "40 hexadecimal characters is exactly valid"
  run_action_pinning_sha_boundary_example \
    "12345678901234567890123456789012345678901" \
    "rejected" \
    "41 hexadecimal characters is too long"
}

run_action_pinning_local_action_exempt_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given ".github/workflows/ci.yml" contains the action reference "./.github/actions/setup-backend"
  {
    printf 'name: ci\n'
    printf 'jobs:\n'
    printf '  backend-checks:\n'
    printf '    steps:\n'
    printf '      - uses: ./.github/actions/setup-backend\n'
  } >"$workflow_file"

  # When the workflow action pinning rule is evaluated
  node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning local action exempt: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # Then the local action reference is ignored by R-02
  if printf '%s\n' "$stdout" | grep -Fq "moving_reference=./.github/actions/setup-backend"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning local action exempt: local action was reported as moving
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  # And the action pinning assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "action_pinning=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning local action exempt: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_action_pinning_github_maintained_external_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given ".github/workflows/ci.yml" contains the action reference "actions/checkout@v4"
  {
    printf 'name: ci\n'
    printf 'jobs:\n'
    printf '  backend-checks:\n'
    printf '    steps:\n'
    printf '      - uses: actions/checkout@v4\n'
  } >"$workflow_file"

  # When the workflow action pinning rule is evaluated
  node "$SCRIPT" action-pinning --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the action pinning assertion fails
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning GitHub-maintained action: expected non-zero exit
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "actions/checkout@v4"
  if ! printf '%s\n' "$combined" | grep -Fq "actions/checkout@v4"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning GitHub-maintained action: missing action reference in failure
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "GitHub-maintained actions must be pinned to a full commit SHA"
  if ! printf '%s\n' "$combined" | grep -Fq "GitHub-maintained actions must be pinned to a full commit SHA"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x action pinning GitHub-maintained action: missing GitHub-maintained failure message
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_no_high_or_critical_case() {
  local audit_file stdout stderr stdout_file stderr_file ec

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm audit report contains 2 low vulnerabilities and 1 moderate vulnerability
  # And the pnpm audit report contains 0 high vulnerabilities
  # And the pnpm audit report contains 0 critical vulnerabilities
  cat >"$audit_file" <<'JSON'
{
  "metadata": {
    "vulnerabilities": {
      "low": 2,
      "moderate": 1,
      "high": 0,
      "critical": 0
    }
  }
}
JSON

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"

  # When the supply-chain audit gate evaluates the report with audit level "high"
  # Then the supply-chain audit gate passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate no high or critical: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "audit_gate=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate no high or critical: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_missing_vulnerability_metadata_case() {
  local audit_file stdout stderr stdout_file stderr_file ec

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  printf '{}\n' >"$audit_file"

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 2 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate missing vulnerability metadata: expected exit 2, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "metadata.vulnerabilities"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate missing vulnerability metadata: missing validation message
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_high_vulnerability_case() {
  local audit_file stdout stderr stdout_file stderr_file ec combined

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm audit report contains 1 high vulnerability named "GHSA-high-0001"
  # And the pnpm audit report contains 0 critical vulnerabilities
  cat >"$audit_file" <<'JSON'
{
  "metadata": {
    "vulnerabilities": {
      "low": 0,
      "moderate": 0,
      "high": 1,
      "critical": 0
    }
  },
  "advisories": {
    "GHSA-high-0001": {
      "severity": "high"
    }
  }
}
JSON

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the supply-chain audit gate evaluates the report with audit level "high"
  # Then the supply-chain audit gate fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate high vulnerability: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "audit_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate high vulnerability: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure reason mentions the high severity vulnerability "GHSA-high-0001"
  if ! printf '%s\n' "$combined" | grep -Fq "high severity vulnerability GHSA-high-0001"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate high vulnerability: missing named high vulnerability
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_high_without_advisory_name_case() {
  local audit_file stdout stderr stdout_file stderr_file ec combined

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$audit_file" <<'JSON'
{
  "metadata": {
    "vulnerabilities": {
      "low": 0,
      "moderate": 0,
      "high": 1,
      "critical": 0
    }
  },
  "advisories": {}
}
JSON

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate high without advisory name: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "pnpm audit reported 1 high severity vulnerability"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate high without advisory name: missing fallback failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_mixed_high_and_critical_prioritizes_critical_case() {
  local audit_file stdout stderr stdout_file stderr_file ec combined

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$audit_file" <<'JSON'
{
  "metadata": {
    "vulnerabilities": {
      "low": 0,
      "moderate": 0,
      "high": 1,
      "critical": 1
    }
  },
  "advisories": {
    "GHSA-high-0001": {
      "severity": "high"
    }
  }
}
JSON

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate mixed high and critical: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "critical severity vulnerability"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate mixed high and critical: missing critical failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_audit_gate_critical_vulnerability_case() {
  local audit_file stdout stderr stdout_file stderr_file ec combined

  audit_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the pnpm audit report contains 0 high vulnerabilities
  # And the pnpm audit report contains 1 critical vulnerability named "GHSA-critical-0001"
  cat >"$audit_file" <<'JSON'
{
  "metadata": {
    "vulnerabilities": {
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 1
    }
  },
  "advisories": {
    "GHSA-critical-0001": {
      "severity": "critical"
    }
  }
}
JSON

  node "$SCRIPT" audit-gate \
    --input "$audit_file" \
    --audit-level high \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$audit_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the supply-chain audit gate evaluates the report with audit level "high"
  # Then the supply-chain audit gate fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate critical vulnerability: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "audit_gate=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate critical vulnerability: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure reason mentions the critical severity vulnerability "GHSA-critical-0001"
  if ! printf '%s\n' "$combined" | grep -Fq "critical severity vulnerability GHSA-critical-0001"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x audit gate critical vulnerability: missing named critical vulnerability
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_scan_config_pass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          severity: HIGH,CRITICAL
          exit-code: "1"
YAML

  # Given the build-docker job contains an aquasecurity/trivy-action step
  # And the Trivy input severity is "HIGH,CRITICAL"
  # And the Trivy input exit-code is "1"
  node "$SCRIPT" trivy-scan-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the Trivy scan configuration is evaluated
  # Then the Trivy scan configuration assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_scan_config=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the scan blocks HIGH and CRITICAL vulnerabilities
  if ! printf '%s\n' "$stdout" | grep -Fq "blocking_severities=HIGH,CRITICAL"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config pass: missing blocking severities
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_scan_config_equivalent_severity_order_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          severity: CRITICAL,HIGH
          exit-code: "1"
YAML

  node "$SCRIPT" trivy-scan-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config equivalent severity order: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_scan_config=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config equivalent severity order: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "blocking_severities=HIGH,CRITICAL"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config equivalent severity order: missing normalized blocking severities
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_scan_config_missing_blocking_severity_case() {
  local severity="$1"
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          severity: ${severity}
          exit-code: "1"
YAML

  # Given the build-docker job contains an aquasecurity/trivy-action step
  # And the Trivy input severity is "<severity>"
  # And the Trivy input exit-code is "1"
  node "$SCRIPT" trivy-scan-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the Trivy scan configuration is evaluated
  # Then the Trivy scan configuration assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing blocking severity ${severity}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_scan_config=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing blocking severity ${severity}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "Trivy severity must be HIGH,CRITICAL"
  if ! printf '%s\n' "$combined" | grep -Fq "Trivy severity must be HIGH,CRITICAL"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing blocking severity ${severity}: missing severity failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_scan_config_missing_action_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Build image
        uses: docker/build-push-action@0123456789abcdef0123456789abcdef01234567
        with:
          push: false
YAML

  # Given the build-docker job contains no action reference starting with "aquasecurity/trivy-action@"
  node "$SCRIPT" trivy-scan-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the Trivy scan configuration is evaluated
  # Then the Trivy scan configuration assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing action: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_scan_config=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing action: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "build-docker must use aquasecurity/trivy-action"
  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must use aquasecurity/trivy-action"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config missing action: missing action failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_scan_config_exit_code_boundary_case() {
  local exit_code="$1"
  local expected_outcome="$2"
  local expected_reason="$3"
  local expected_exit=1
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if [ "$expected_outcome" = "accepted" ]; then
    expected_exit=0
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          severity: HIGH,CRITICAL
          exit-code: "${exit_code}"
YAML

  # Given the build-docker job contains an aquasecurity/trivy-action step
  # And the Trivy input severity is "HIGH,CRITICAL"
  # And the Trivy input exit-code is "<exit_code>"
  node "$SCRIPT" trivy-scan-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne "$expected_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config exit-code boundary ${exit_code}: expected exit ${expected_exit}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Trivy scan configuration is evaluated
  # Then the Trivy scan configuration outcome is "<outcome>"
  if ! printf '%s\n' "$stdout" | grep -Fq "exit_code_outcome=${expected_outcome}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config exit-code boundary ${exit_code}: missing expected outcome ${expected_outcome}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the boundary reason is "<reason>"
  if ! printf '%s\n' "$stdout" | grep -Fq "boundary_reason=${expected_reason}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy scan config exit-code boundary ${exit_code}: missing boundary reason ${expected_reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_pass_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: trivy-results.sarif
YAML

  # Given the Trivy input format is "sarif"
  # And the Trivy input output is "trivy-results.sarif"
  # And the build-docker job contains a github/codeql-action/upload-sarif step
  # And the SARIF upload input sarif_file is "trivy-results.sarif"
  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config pass: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the SARIF upload configuration is evaluated
  # Then the SARIF upload assertion passes
  if ! printf '%s\n' "$stdout" | grep -Fq "sarif_upload=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config pass: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the Trivy SARIF result is available to GitHub Security
  if ! printf '%s\n' "$stdout" | grep -Fq "github_security=trivy-results.sarif"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config pass: missing GitHub Security SARIF result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_expression_condition_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
      - name: Upload Trivy SARIF
        if: ${{ always() }}
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: trivy-results.sarif
YAML

  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config expression condition: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "sarif_upload=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config expression condition: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_upload_before_trivy_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: trivy-results.sarif
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
YAML

  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config upload before Trivy: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "SARIF upload must run after Trivy scan"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config upload before Trivy: missing ordering failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_missing_upload_action_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
YAML

  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config missing CodeQL upload action: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "sarif_upload_step=missing"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config missing CodeQL upload action: missing upload-step marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "build-docker must upload Trivy SARIF via CodeQL"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config missing CodeQL upload action: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_different_upload_path_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: container-results.sarif
YAML

  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config different upload path: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "boundary_reason=SARIF upload path must be trivy-results.sarif"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config different upload path: missing boundary reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "sarif_file must be trivy-results.sarif"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config different upload path: missing sarif_file failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_config_boundary_case() {
  local trivy_format="$1"
  local trivy_output="$2"
  local upload_path="$3"
  local condition="$4"
  local expected_outcome="$5"
  local expected_reason="$6"
  local expected_exit=1
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  if [ "$expected_outcome" = "accepted" ]; then
    expected_exit=0
  fi

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: ${trivy_format}
          output: ${trivy_output}
      - name: Upload Trivy SARIF
        if: ${condition}
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: ${upload_path}
YAML

  node "$SCRIPT" trivy-sarif-upload-config --workflow "$workflow_file" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne "$expected_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config boundary ${trivy_format}/${trivy_output}/${upload_path}/${condition}: expected exit ${expected_exit}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "sarif_upload_outcome=${expected_outcome}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config boundary ${trivy_format}/${trivy_output}/${upload_path}/${condition}: missing expected outcome ${expected_outcome}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "boundary_reason=${expected_reason}"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload config boundary ${trivy_format}/${trivy_output}/${upload_path}/${condition}: missing boundary reason ${expected_reason}
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_vulnerability_gate_no_high_or_critical_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the Trivy result for "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" contains 3 LOW vulnerabilities
  # And the Trivy result contains 1 MEDIUM vulnerability
  # And the Trivy result contains 0 HIGH vulnerabilities
  # And the Trivy result contains 0 CRITICAL vulnerabilities
  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": [
        { "VulnerabilityID": "CVE-2026-low-0001", "Severity": "LOW" },
        { "VulnerabilityID": "CVE-2026-low-0002", "Severity": "LOW" },
        { "VulnerabilityID": "CVE-2026-low-0003", "Severity": "LOW" },
        { "VulnerabilityID": "CVE-2026-medium-0001", "Severity": "MEDIUM" }
      ]
    }
  ]
}
JSON

  node "$SCRIPT" trivy-vulnerability-gate \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the image vulnerability assertion is evaluated
  # Then the image vulnerability assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate no high or critical: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "image_vulnerability=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate no high or critical: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And no HIGH or CRITICAL vulnerability is reported for the built image
  if printf '%s\n' "$combined" | grep -Fq "blocking_vulnerability="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate no high or critical: unexpected blocking vulnerability
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_vulnerability_gate_null_vulnerabilities_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": null
    }
  ]
}
JSON

  node "$SCRIPT" trivy-vulnerability-gate \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate null vulnerabilities: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "image_vulnerability=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate null vulnerabilities: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if printf '%s\n' "$combined" | grep -Fq "blocking_vulnerability="; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate null vulnerabilities: unexpected blocking vulnerability
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_vulnerability_gate_high_vulnerability_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the Trivy result for "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" contains 1 HIGH vulnerability named "CVE-2026-1001"
  # And the Trivy result contains 0 CRITICAL vulnerabilities
  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": [
        { "VulnerabilityID": "CVE-2026-1001", "Severity": "HIGH" }
      ]
    }
  ]
}
JSON

  node "$SCRIPT" trivy-vulnerability-gate \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the image vulnerability assertion is evaluated
  # Then the image vulnerability assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate high vulnerability: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "image_vulnerability=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate high vulnerability: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "CVE-2026-1001"
  if ! printf '%s\n' "$combined" | grep -Fq "CVE-2026-1001"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate high vulnerability: missing CVE
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "HIGH"
  if ! printf '%s\n' "$combined" | grep -Fq "HIGH"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate high vulnerability: missing severity
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_vulnerability_gate_critical_vulnerability_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the Trivy result for "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" contains 0 HIGH vulnerabilities
  # And the Trivy result contains 1 CRITICAL vulnerability named "CVE-2026-2002"
  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": [
        { "VulnerabilityID": "CVE-2026-2002", "Severity": "CRITICAL" }
      ]
    }
  ]
}
JSON

  node "$SCRIPT" trivy-vulnerability-gate \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the image vulnerability assertion is evaluated
  # Then the image vulnerability assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate critical vulnerability: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "image_vulnerability=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate critical vulnerability: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "CVE-2026-2002"
  if ! printf '%s\n' "$combined" | grep -Fq "CVE-2026-2002"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate critical vulnerability: missing CVE
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "CRITICAL"
  if ! printf '%s\n' "$combined" | grep -Fq "CRITICAL"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate critical vulnerability: missing severity
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_vulnerability_gate_missing_result_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": null
    }
  ]
}
JSON

  # Given the Docker build step produces image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  # And no Trivy result exists for image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  node "$SCRIPT" trivy-vulnerability-gate \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the image vulnerability assertion is evaluated
  # Then the image vulnerability assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate missing result: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "image_vulnerability=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate missing result: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions "missing Trivy result for built image"
  if ! printf '%s\n' "$combined" | grep -Fq "missing Trivy result for built image"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy vulnerability gate missing result: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_step_completion_nonzero_result_case() {
  local trivy_file stdout stderr stdout_file stderr_file ec combined

  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": [
        { "VulnerabilityID": "CVE-2026-3003", "Severity": "HIGH" }
      ]
    }
  ]
}
JSON

  # Given Trivy scans image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  # And Trivy reports 1 HIGH vulnerability named "CVE-2026-3003"
  # And the Trivy input exit-code is "1"
  node "$SCRIPT" trivy-step-completion \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    --exit-code "1" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy step completion nonzero result: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  # When the Trivy step completes
  # Then the Trivy step exits with status 1
  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_step_exit=1"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy step completion nonzero result: missing step exit status
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the build-docker job fails
  if ! printf '%s\n' "$stdout" | grep -Fq "build_docker_result=failure"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy step completion nonzero result: missing build-docker failure result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_trivy_sarif_upload_after_failure_case() {
  local workflow_file trivy_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  trivy_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  build-docker:
    runs-on: ubuntu-latest
    steps:
      - name: Scan built image
        uses: aquasecurity/trivy-action@0123456789abcdef0123456789abcdef01234567
        with:
          image-ref: sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          format: sarif
          output: trivy-results.sarif
      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@89abcdef0123456789abcdef0123456789abcdef
        with:
          sarif_file: trivy-results.sarif
YAML

  cat >"$trivy_file" <<'JSON'
{
  "ArtifactName": "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Results": [
    {
      "Target": "sovri/community-bot",
      "Vulnerabilities": [
        { "VulnerabilityID": "CVE-2026-3003", "Severity": "HIGH" }
      ]
    }
  ]
}
JSON

  node "$SCRIPT" trivy-sarif-upload-after-failure \
    --workflow "$workflow_file" \
    --input "$trivy_file" \
    --image "sovri/community-bot:ci-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
    --exit-code "1" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$trivy_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload after failure: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "trivy_step_exit=1"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload after failure: missing Trivy exit status
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "blocking_vulnerability=CVE-2026-3003"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload after failure: missing blocking vulnerability
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "sarif_upload_step=ran"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload after failure: missing upload step run marker
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "github_security=trivy-results.sarif"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x Trivy SARIF upload after failure: missing GitHub Security SARIF result
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_depth_zero_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs: # workflow jobs
    secrets-scan: # secrets policy job
      runs-on: ubuntu-latest
      steps: # scan steps
        - name: Checkout repository
          uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # pinned checkout
          with:
            fetch-depth: "0" # full history
YAML

  # Given the secrets-scan job contains a checkout step using "actions/checkout"
  # And that checkout step has input "fetch-depth" set to 0
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # When the checkout depth rule is evaluated
  # Then the checkout depth assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout depth zero: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout depth zero: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the secrets-scan job is classified as scanning full history
  if ! printf '%s\n' "$combined" | grep -Fq "history_scope=full"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout depth zero: missing full-history classification
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_missing_step_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - run: echo scan
YAML

  # Given the secrets-scan job contains no checkout step using "actions/checkout"
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing step: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing step: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the required full-history checkout configuration
  if ! printf '%s\n' "$combined" | grep -Fq "secrets-scan must use actions/checkout with fetch-depth: 0"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing step: missing checkout failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_missing_fetch_depth_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
YAML

  # Given the secrets-scan job contains a checkout step using "actions/checkout"
  # And that checkout step omits the input "fetch-depth"
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing fetch-depth: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing fetch-depth: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the required fetch-depth value
  if ! printf '%s\n' "$combined" | grep -Fq "fetch-depth: 0"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout missing fetch-depth: missing fetch-depth failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_positive_fetch_depth_case() {
  local fetch_depth workflow_file stdout stderr stdout_file stderr_file ec combined
  fetch_depth="$1"

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<YAML
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        with:
          fetch-depth: ${fetch_depth}
YAML

  # Given the secrets-scan job contains a checkout step using "actions/checkout"
  # And that checkout step has input "fetch-depth" set to a positive value
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout positive fetch-depth ${fetch_depth}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout positive fetch-depth ${fetch_depth}: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions that secrets-scan must checkout full history
  if ! printf '%s\n' "$combined" | grep -Fq "secrets-scan must checkout full history"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout positive fetch-depth ${fetch_depth}: missing full-history failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_other_job_full_history_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout backend
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        with:
          fetch-depth: 0
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@fedcba9876543210fedcba9876543210fedcba98
        with:
          fetch-depth: 1
YAML

  # Given another job contains a checkout step with input "fetch-depth" set to 0
  # And the secrets-scan job contains a checkout step with input "fetch-depth" set to 1
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout other job full history: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout other job full history: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions that fetch-depth: 0 must be configured in secrets-scan
  if ! printf '%s\n' "$combined" | grep -Fq "fetch-depth: 0"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout other job full history: missing fetch-depth failure message
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_requires_steps_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
            fetch-depth: 0
    steps:
      - run: echo scan
YAML

  # Given the secrets-scan job has checkout-like data outside the steps list
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails instead of accepting matrix data
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout requires steps: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout requires steps: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_rejects_shallow_checkout_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Full checkout
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        with:
          fetch-depth: 0
      - name: Shallow checkout
        uses: actions/checkout@fedcba9876543210fedcba9876543210fedcba98
        with:
          fetch-depth: 1
YAML

  # Given one checkout step is full-history and another checkout step is shallow
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails because every checkout must scan full history
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout rejects shallow checkout: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout rejects shallow checkout: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_requires_with_fetch_depth_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        env:
          fetch-depth: 0
YAML

  # Given a checkout step has fetch-depth-like data outside checkout inputs
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion fails because fetch-depth must be under with
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout requires with fetch-depth: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout requires with fetch-depth: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_inline_with_mapping_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
        with: { fetch-depth: 0 }
YAML

  # Given a checkout step declares fetch-depth through an inline with mapping
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the checkout depth assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout inline with mapping: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout inline with mapping: missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_ignores_scalar_job_key_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - run: >-1
          secrets-scan:
            runs-on: ubuntu-latest
            steps:
              - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
                with:
                  fetch-depth: 0
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fedcba9876543210fedcba9876543210fedcba98
        with:
          fetch-depth: 1
YAML

  # Given another job emits YAML-like secrets-scan text in a script block
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the real secrets-scan job controls the policy result
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout ignores scalar job key: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout ignores scalar job key: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_secrets_checkout_ignores_scalar_step_case() {
  local workflow_file stdout stderr stdout_file stderr_file ec combined

  workflow_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$workflow_file" <<'YAML'
name: ci
jobs:
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - run: |2
          - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
            with:
              fetch-depth: 0
      - run: echo scan
YAML

  # Given the secrets-scan job has checkout-like text inside a script block
  node "$SCRIPT" secrets-checkout-depth \
    --workflow "$workflow_file" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$workflow_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then script text is not accepted as a checkout step
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout ignores scalar step: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "checkout_depth=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x secrets checkout ignores scalar step: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_false_positive_fixture_resolved_case() {
  local resolution_reason evidence_file stdout stderr stdout_file stderr_file ec combined
  resolution_reason="$1"

  evidence_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$evidence_file" <<JSON
{
  "fixtures": [
    {
      "path": "tests/fixtures/secrets/benign-github-token-like-string.txt",
      "matches": [
        {
          "id": "github-token-benign-fixture",
          "status": "resolved",
          "resolution_reason": "${resolution_reason}"
        }
      ]
    }
  ]
}
JSON

  # Given the false-positive fixture is present in the fixture corpus
  # And the false-positive fixture is marked as resolved with a reason
  # And the fixture corpus contains 0 unresolved secret matches
  node "$SCRIPT" secrets-fixture-evidence \
    --input "$evidence_file" \
    --false-positive-fixture "tests/fixtures/secrets/benign-github-token-like-string.txt" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$evidence_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the false-positive fixture assertion passes
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture resolved (${resolution_reason}): expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "fixture_evidence=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture resolved (${resolution_reason}): missing pass assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the evidence report lists the false-positive fixture as resolved
  if ! printf '%s\n' "$combined" | grep -Fq "resolved_fixture=tests/fixtures/secrets/benign-github-token-like-string.txt"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture resolved (${resolution_reason}): missing resolved fixture
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_false_positive_fixture_empty_reason_case() {
  local evidence_file stdout stderr stdout_file stderr_file ec combined

  evidence_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$evidence_file" <<'JSON'
{
  "fixtures": [
    {
      "path": "tests/fixtures/secrets/benign-github-token-like-string.txt",
      "matches": [
        {
          "id": "github-token-benign-fixture",
          "status": "resolved",
          "resolution_reason": ""
        }
      ]
    }
  ]
}
JSON

  # Given the false-positive fixture has an empty resolution reason
  node "$SCRIPT" secrets-fixture-evidence \
    --input "$evidence_file" \
    --false-positive-fixture "tests/fixtures/secrets/benign-github-token-like-string.txt" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$evidence_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the false-positive fixture assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture empty reason: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "fixture_evidence=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture empty reason: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_false_positive_fixture_absent_case() {
  local evidence_file stdout stderr stdout_file stderr_file ec combined

  evidence_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$evidence_file" <<'JSON'
{
  "fixtures": []
}
JSON

  # Given the false-positive fixture is absent from the fixture corpus
  node "$SCRIPT" secrets-fixture-evidence \
    --input "$evidence_file" \
    --false-positive-fixture "tests/fixtures/secrets/benign-github-token-like-string.txt" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$evidence_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the false-positive fixture assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture absent: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "tests/fixtures/secrets/benign-github-token-like-string.txt"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture absent: missing fixture path
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "false-positive fixture must be present"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture absent: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_false_positive_fixture_unresolved_case() {
  local evidence_file stdout stderr stdout_file stderr_file ec combined

  evidence_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$evidence_file" <<'JSON'
{
  "fixtures": [
    {
      "path": "tests/fixtures/secrets/benign-github-token-like-string.txt",
      "matches": [
        {
          "id": "github-token-benign-fixture",
          "status": "unresolved"
        }
      ]
    }
  ]
}
JSON

  # Given the false-positive fixture is present but unresolved
  node "$SCRIPT" secrets-fixture-evidence \
    --input "$evidence_file" \
    --false-positive-fixture "tests/fixtures/secrets/benign-github-token-like-string.txt" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$evidence_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the false-positive fixture assertion fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture unresolved: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "tests/fixtures/secrets/benign-github-token-like-string.txt"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture unresolved: missing fixture path
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "false-positive fixture must be resolved before merge"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture unresolved: missing failure reason
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_false_positive_fixture_real_leak_case() {
  local evidence_file stdout stderr stdout_file stderr_file ec combined

  evidence_file=$(mktemp)
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  cat >"$evidence_file" <<'JSON'
{
  "fixtures": [
    {
      "path": "tests/fixtures/secrets/benign-github-token-like-string.txt",
      "matches": [
        {
          "id": "github-token-benign-fixture",
          "status": "resolved",
          "resolution_reason": "benign documentation token shape"
        }
      ]
    },
    {
      "path": "tests/fixtures/secrets/leaked-github-token.txt",
      "matches": [
        {
          "id": "github-token-real-leak-001",
          "status": "unresolved"
        }
      ]
    }
  ]
}
JSON

  # Given the false-positive fixture is marked as resolved
  # And the real leak fixture contains an unresolved detector match
  node "$SCRIPT" secrets-fixture-evidence \
    --input "$evidence_file" \
    --false-positive-fixture "tests/fixtures/secrets/benign-github-token-like-string.txt" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$evidence_file" "$stdout_file" "$stderr_file"
  combined=$(printf '%s\n%s\n' "$stdout" "$stderr")

  # Then the secrets-scan fixture evidence fails
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture real leak: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "fixture_evidence=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture real leak: missing fail assertion
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  # And the failure mentions the real leak detector match and fixture path
  if ! printf '%s\n' "$combined" | grep -Fq "github-token-real-leak-001"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture real leak: missing detector match
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "tests/fixtures/secrets/leaked-github-token.txt"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x false-positive fixture real leak: missing fixture path
$(printf '%s\n' "$combined" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_ci_policy_success_case() {
  local name="$1"
  local expected_stdout="$2"
  local stdout stderr stdout_file stderr_file ec combined
  shift 2

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" "$@" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x ${name}: expected exit 0, got ${ec}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "$expected_stdout"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x ${name}: missing stdout ${expected_stdout}
$(printf '%s\n' "$stdout" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_ci_policy_failure_case() {
  local name="$1"
  local expected_message="$2"
  local stdout stderr stdout_file stderr_file ec combined
  shift 2

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" "$@" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  combined="${stdout}
${stderr}"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x ${name}: expected non-zero exit
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  if ! printf '%s\n' "$combined" | grep -Fq "$expected_message"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  x ${name}: missing message ${expected_message}
$(printf '%s\n' "$combined" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

CODEQL_TEST_CHECKOUT_SHA="1234567890123456789012345678901234567890"
CODEQL_TEST_ACTION_SHA="abcdefabcdefabcdefabcdefabcdefabcdefabcd"
DEPENDENCY_REVIEW_TEST_ACTION_SHA="a1d282b36b6f3519aa1f3fc636f609c47dddb294"
DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES="Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0"
DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES="AGPL-1.0-only, AGPL-1.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later, GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, LGPL-2.0-only, LGPL-2.0-or-later, LGPL-2.1-only, LGPL-2.1-or-later, LGPL-3.0-only, LGPL-3.0-or-later"

codeql_standard_trigger_body() {
  printf '%s\n' \
    "  push:" \
    "    branches:" \
    "      - main" \
    "  pull_request:" \
    "  schedule:" \
    "    - cron: \"0 6 * * 1\""
}

codeql_standard_permissions_body() {
  printf '%s\n' \
    "  actions: read" \
    "  contents: read" \
    "  security-events: write"
}

write_codeql_workflow_fixture() {
  local workflow_file="$1"
  local trigger_body="$2"
  local permissions_body="$3"
  local timeout_minutes="$4"
  local language="$5"
  local queries="$6"
  local category="$7"
  local checkout_ref="$8"
  local init_ref="$9"
  local analyze_ref="${10}"

  cat >"$workflow_file" <<YAML
name: CodeQL

on:
${trigger_body}

permissions:
${permissions_body}

jobs:
  codeql:
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout_minutes}
    steps:
      - name: Checkout
        uses: actions/checkout@${checkout_ref}
      - name: Initialize CodeQL
        uses: github/codeql-action/init@${init_ref}
        with:
          languages: ${language}
          queries: ${queries}
      - name: Perform CodeQL analysis
        uses: github/codeql-action/analyze@${analyze_ref}
        with:
          category: "${category}"
YAML
}

write_standard_codeql_workflow() {
  local workflow_file="$1"

  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"
}

run_codeql_duration_pass_case() {
  local elapsed_ms="$1"
  local reported_duration="$2"

  run_ci_policy_success_case "codeql duration pass ${elapsed_ms}" "codeql_duration_budget=pass" \
    codeql-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$((100000 + elapsed_ms))"

  run_ci_policy_success_case "codeql duration report ${elapsed_ms}" "reported_duration=${reported_duration}" \
    codeql-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$((100000 + elapsed_ms))"
}

run_codeql_duration_fail_case() {
  local elapsed_ms="$1"

  run_ci_policy_failure_case "codeql duration fail ${elapsed_ms}" "CodeQL must finish in under 8 minutes" \
    codeql-duration-budget \
    --job-start-ms 100000 \
    --job-end-ms "$((100000 + elapsed_ms))"
}

run_codeql_workflow_config_pass_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_standard_codeql_workflow "$workflow_file"

  run_ci_policy_success_case "codeql workflow config pass" "codeql_workflow=pass" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_missing_trigger_case() {
  local name="$1"
  local trigger_body="$2"
  local expected_message="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$trigger_body" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql missing trigger ${name}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_cron_boundary_case() {
  local cron_value="$1"
  local outcome="$2"
  local reason="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "  push:
    branches:
      - main
  pull_request:
  schedule:
    - cron: \"${cron_value}\"" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "codeql cron ${cron_value}" "boundary_reason=${reason}" \
      codeql-workflow-config --workflow "$workflow_file"
  else
    run_ci_policy_failure_case "codeql cron ${cron_value}" "$reason" \
      codeql-workflow-config --workflow "$workflow_file"
  fi

  rm -f "$workflow_file"
}

run_codeql_workflow_permission_case() {
  local name="$1"
  local permissions_body="$2"
  local expected_message="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$permissions_body" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql permission ${name}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_language_case() {
  local language="$1"
  local expected_message="$2"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "$language" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql language ${language}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_queries_case() {
  local queries="$1"
  local expected_message="$2"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "$queries" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql queries ${queries}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_category_case() {
  local category="$1"
  local expected_message="$2"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "$category" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql category ${category}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_timeout_case() {
  local timeout_minutes="$1"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "$timeout_minutes" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$CODEQL_TEST_CHECKOUT_SHA" \
    "$CODEQL_TEST_ACTION_SHA" \
    "$CODEQL_TEST_ACTION_SHA"

  run_ci_policy_failure_case "codeql timeout ${timeout_minutes}" "CodeQL job timeout-minutes must be 8" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_codeql_workflow_pinning_case() {
  local name="$1"
  local checkout_ref="$2"
  local init_ref="$3"
  local analyze_ref="$4"
  local expected_message="$5"
  local workflow_file

  workflow_file=$(mktemp)
  write_codeql_workflow_fixture \
    "$workflow_file" \
    "$(codeql_standard_trigger_body)" \
    "$(codeql_standard_permissions_body)" \
    "8" \
    "javascript" \
    "+security-extended,security-and-quality" \
    "/language:javascript" \
    "$checkout_ref" \
    "$init_ref" \
    "$analyze_ref"

  run_ci_policy_failure_case "codeql pinning ${name}" "$expected_message" \
    codeql-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

dependency_review_standard_trigger_body() {
  printf '%s\n' \
    "  pull_request:" \
    "    branches:" \
    "      - main"
}

write_dependency_review_workflow_fixture() {
  local workflow_file="$1"
  local trigger_body="$2"
  local action_ref="$3"
  local fail_on_severity="$4"
  local allow_licenses="$5"
  local deny_licenses="$6"
  local action_step="$7"

  cat >"$workflow_file" <<YAML
name: Dependency Review

on:
${trigger_body}

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
${action_step}
YAML

  if [ "$action_step" = standard ]; then
    cat >"$workflow_file" <<YAML
name: Dependency Review

on:
${trigger_body}

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Dependency Review allowed licenses
        uses: actions/dependency-review-action@${action_ref}
        with:
          fail-on-severity: ${fail_on_severity}
          allow-licenses: ${allow_licenses}
      - name: Dependency Review denied licenses
        uses: actions/dependency-review-action@${action_ref}
        with:
          fail-on-severity: ${fail_on_severity}
          deny-licenses: ${deny_licenses}
YAML
  fi
}

write_standard_dependency_review_workflow() {
  local workflow_file="$1"

  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard
}

run_dependency_review_workflow_config_pass_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_standard_dependency_review_workflow "$workflow_file"

  # Given ".github/workflows/dependency-review.yml" declares the required
  # pull_request trigger, action pin, high severity threshold, allow list, and deny list
  # When the Dependency Review workflow rule is evaluated
  # Then the Dependency Review assertion passes
  run_ci_policy_success_case "dependency review workflow config pass" "dependency_review_workflow=pass" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_mit_license_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_standard_dependency_review_workflow "$workflow_file"

  # Given ".github/workflows/dependency-review.yml" declares allow-licenses containing "MIT"
  # And ".github/workflows/dependency-review.yml" declares deny-licenses without "MIT"
  # When the Dependency Review license gate evaluates "lodash@4.17.21"
  # Then the license gate assertion passes
  # And the pull request is not blocked for the MIT license
  run_ci_policy_success_case "dependency review MIT allow" "allowed_license=MIT" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_gpl_block_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_standard_dependency_review_workflow "$workflow_file"

  # Given the reviewed dependency license is "GPL-3.0-only"
  # And ".github/workflows/dependency-review.yml" declares deny-licenses containing "GPL-3.0-only"
  # When the Dependency Review license gate evaluates "gpl-only-fixture@1.0.0"
  # Then the pull request is blocked for "GPL-3.0-only"
  run_ci_policy_success_case "dependency review GPL 3 only deny" "denied_license=GPL-3.0-only" \
    dependency-review-workflow-config --workflow "$workflow_file"

  run_ci_policy_success_case "dependency review GPL 3 or later deny" "denied_license=GPL-3.0-or-later" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_trigger_failure_case() {
  local name="$1"
  local trigger_body="$2"
  local expected_message="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$trigger_body" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard

  run_ci_policy_failure_case "dependency review trigger ${name}" "$expected_message" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_action_pinning_case() {
  local name="$1"
  local action_ref="$2"
  local expected_message="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$action_ref" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard

  run_ci_policy_failure_case "dependency review action pinning ${name}" "$expected_message" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_action_pinning_boundary_case() {
  local sha_ref="$1"
  local outcome="$2"
  local reason="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$sha_ref" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "dependency review action pinning boundary ${sha_ref}" "boundary_reason=${reason}" \
      dependency-review-workflow-config --workflow "$workflow_file"
  else
    run_ci_policy_failure_case "dependency review action pinning boundary ${sha_ref}" "$reason" \
      dependency-review-workflow-config --workflow "$workflow_file"
  fi

  rm -f "$workflow_file"
}

run_dependency_review_severity_case() {
  local configured_value="$1"
  local expected_message="$2"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "$configured_value" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard

  run_ci_policy_failure_case "dependency review severity ${configured_value}" "$expected_message" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_missing_severity_input_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Dependency Review allowed licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          allow-licenses: ${DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES}
      - name: Dependency Review denied licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          deny-licenses: ${DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES}"

  run_ci_policy_failure_case "dependency review missing severity input" "fail-on-severity: high is required" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_wrong_step_severity_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Shell severity
        run: echo 'fail-on-severity: high'
      - name: Dependency Review allowed licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          allow-licenses: ${DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES}
      - name: Dependency Review denied licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          deny-licenses: ${DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES}"

  run_ci_policy_failure_case "dependency review wrong severity step" "fail-on-severity must be configured on actions/dependency-review-action" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_missing_action_step_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Placeholder
        run: echo 'dependency review action is missing'"

  run_ci_policy_failure_case "dependency review missing action step" "actions/dependency-review-action is required" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_license_failure_case() {
  local name="$1"
  local allow_licenses="$2"
  local deny_licenses="$3"
  local expected_message="$4"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$allow_licenses" \
    "$deny_licenses" \
    standard

  run_ci_policy_failure_case "dependency review licenses ${name}" "$expected_message" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_allow_whitespace_case() {
  local raw_allow_licenses="$1"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$raw_allow_licenses" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    standard

  run_ci_policy_success_case "dependency review allow whitespace" "allow_licenses=exact" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_deny_whitespace_case() {
  local raw_deny_licenses="$1"
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$raw_deny_licenses" \
    standard

  run_ci_policy_success_case "dependency review deny whitespace" "deny_licenses=exact" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_combined_license_inputs_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Dependency Review
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          allow-licenses: ${DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES}
          deny-licenses: ${DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES}"

  run_ci_policy_failure_case "dependency review combined license inputs" "allow-licenses and deny-licenses must be configured on separate actions/dependency-review-action steps" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_multiline_license_inputs_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Dependency Review allowed licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          allow-licenses: |
            Apache-2.0,
            MIT,
            BSD-2-Clause,
            BSD-3-Clause,
            ISC,
            MPL-2.0,
            CC0-1.0,
            Unlicense,
            BlueOak-1.0.0
      - name: Dependency Review denied licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          deny-licenses: |
            AGPL-1.0-only,
            AGPL-1.0-or-later,
            AGPL-3.0-only,
            AGPL-3.0-or-later,
            GPL-2.0-only,
            GPL-2.0-or-later,
            GPL-3.0-only,
            GPL-3.0-or-later,
            LGPL-2.0-only,
            LGPL-2.0-or-later,
            LGPL-2.1-only,
            LGPL-2.1-or-later,
            LGPL-3.0-only,
            LGPL-3.0-or-later"

  run_ci_policy_success_case "dependency review multiline license inputs" "allow_licenses=exact" \
    dependency-review-workflow-config --workflow "$workflow_file"

  run_ci_policy_success_case "dependency review multiline license inputs" "deny_licenses=exact" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_dependency_review_duplicate_license_step_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_dependency_review_workflow_fixture \
    "$workflow_file" \
    "$(dependency_review_standard_trigger_body)" \
    "$DEPENDENCY_REVIEW_TEST_ACTION_SHA" \
    "high" \
    "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" \
    "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" \
    "      - name: Dependency Review allowed licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          allow-licenses: ${DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES}
      - name: Dependency Review extra allowed licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          allow-licenses: MIT
      - name: Dependency Review denied licenses
        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_TEST_ACTION_SHA}
        with:
          fail-on-severity: high
          deny-licenses: ${DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES}"

  run_ci_policy_failure_case "dependency review duplicate license step" "allow-licenses must be configured on exactly one actions/dependency-review-action step" \
    dependency-review-workflow-config --workflow "$workflow_file"

  rm -f "$workflow_file"
}

write_release_trigger_workflow() {
  local workflow_file="$1"
  local trigger_body="$2"

  cat >"$workflow_file" <<YAML
name: Release

on:
${trigger_body}

jobs:
  verify-tag:
    runs-on: ubuntu-latest
    steps:
      - name: Verify tag
        run: node scripts/ci-policy.mjs release-verify-tag --tag v0.1.0 --package-files package.json --changelog CHANGELOG.md
YAML
}

run_release_pipeline_result_case() {
  run_ci_policy_success_case "release pipeline green" "release_pipeline_result=green" \
    release-pipeline-result \
    --verify-tag success \
    --build-and-push success \
    --sbom success \
    --gh-release success
}

run_release_pipeline_failed_job_case() {
  local job_name="$1"

  run_ci_policy_failure_case "release pipeline failed ${job_name}" "${job_name}" \
    release-pipeline-result \
    --verify-tag "$([ "$job_name" = verify-tag ] && printf failure || printf success)" \
    --build-and-push "$([ "$job_name" = build-and-push ] && printf failure || printf success)" \
    --sbom "$([ "$job_name" = sbom ] && printf failure || printf success)" \
    --gh-release "$([ "$job_name" = gh-release ] && printf failure || printf success)"
}

run_release_yml_uses_v_star_filter_case() {
  local repo_root="${SCRIPT_DIR%/scripts}"
  local workflow_path="$repo_root/.github/workflows/release.yml"
  local unprefixed_tag="0.1.0"

  if ! [ -f "$workflow_path" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-yml-uses-v-star-filter: workflow file missing at ${workflow_path}"
    return
  fi

  # And no GitHub Release exists for "0.1.0" -- guarded by GitHub: a tag like
  # "0.1.0" (without leading v) cannot match the `v*` filter declared in the
  # workflow's `on: push: tags` block. Lock that contract here.
  if ! grep -Eq "^[[:space:]]*-[[:space:]]*['\"]?v\\*['\"]?[[:space:]]*$" "$workflow_path"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-yml-uses-v-star-filter: workflow does not declare 'v*' in on.push.tags
$(grep -nE 'tags:' "$workflow_path" | sed 's/^/        /')"
    return
  fi

  case "$unprefixed_tag" in
    v*)
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ release-yml-uses-v-star-filter: tag '${unprefixed_tag}' unexpectedly matches v* glob"
      return
      ;;
  esac

  run_ci_policy_success_case "release trigger on real workflow" "release_trigger=pass" \
    release-trigger --workflow "$workflow_path"
}

run_release_pipeline_outline_failure_case() {
  local label="$1"
  local verify_tag="$2"
  local build_push="$3"
  local sbom="$4"
  local gh_release="$5"

  run_ci_policy_failure_case "release pipeline outline failed ${label}" "release_pipeline_result=failed" \
    release-pipeline-result \
    --verify-tag "$verify_tag" \
    --build-and-push "$build_push" \
    --sbom "$sbom" \
    --gh-release "$gh_release"
}

run_release_pipeline_idempotent_case() {
  run_ci_policy_success_case "release pipeline idempotent rerun" "release_update=existing-release-updated" \
    release-pipeline-result \
    --verify-tag success \
    --build-and-push success \
    --sbom success \
    --gh-release success \
    --existing-release true \
    --existing-tags true
}

run_release_trigger_push_tags_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_trigger_workflow "$workflow_file" "  push:
    tags:
      - \"v*\""

  run_ci_policy_success_case "release trigger push tags" "release_trigger=pass" \
    release-trigger --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_trigger_missing_tags_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_trigger_workflow "$workflow_file" "  push:"

  run_ci_policy_failure_case "release trigger missing tags" "push.tags must include v*" \
    release-trigger --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_trigger_extra_event_case() {
  local extra_event="$1"
  local workflow_file

  workflow_file=$(mktemp)
  write_release_trigger_workflow "$workflow_file" "  push:
    tags:
      - \"v*\"
  ${extra_event}:"

  run_ci_policy_failure_case "release trigger extra ${extra_event}" "release workflow must only run on push tags v*" \
    release-trigger --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_trigger_tag_pattern_boundary_case() {
  local tag_pattern="$1"
  local outcome="$2"
  local reason="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_release_trigger_workflow "$workflow_file" "  push:
    tags:
      - \"${tag_pattern}\""

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "release trigger tag boundary ${tag_pattern}" "boundary_reason=${reason}" \
      release-trigger --workflow "$workflow_file"
  else
    run_ci_policy_failure_case "release trigger tag boundary ${tag_pattern}" "$reason" \
      release-trigger --workflow "$workflow_file"
  fi

  rm -f "$workflow_file"
}

run_release_trigger_extra_tag_pattern_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_trigger_workflow "$workflow_file" "  push:
    tags:
      - \"v*\"
      - \"release-*\""

  run_ci_policy_failure_case "release trigger extra tag pattern" "release workflow must only run on push tags v*" \
    release-trigger --workflow "$workflow_file"

  rm -f "$workflow_file"
}

write_release_metadata_fixture() {
  local root="$1"
  local core_version="$2"
  local bot_version="$3"
  local changelog_heading="$4"

  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"

  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "%s" }\n' "$core_version" >"$root/${package_path}/package.json"
  done
  printf '{ "version": "%s" }\n' "$bot_version" >"$root/apps/community-bot/package.json"
  # release-verify-tag now requires the dated `## [X.Y.Z] - YYYY-MM-DD` form,
  # so bare `## [X.Y.Z]` heading fixtures are auto-extended with a stable
  # placeholder date.
  local final_heading="$changelog_heading"
  if printf '%s' "$changelog_heading" | grep -Eq '^## \[[^]]+\]$'; then
    final_heading="$changelog_heading - 2026-05-23"
  fi
  printf '# Changelog\n\n%s\n\n- Release notes.\n' "$final_heading" >"$root/CHANGELOG.md"
}

release_metadata_package_files() {
  local root="$1"
  printf '%s' "$root/packages/core/package.json,$root/packages/review-engine/package.json,$root/packages/llm-providers/package.json,$root/packages/config/package.json,$root/packages/observability/package.json,$root/apps/community-bot/package.json"
}

run_release_verify_tag_match_case() {
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "0.1.0" "0.1.0" "## [0.1.0]"
  package_files=$(release_metadata_package_files "$root")

  run_ci_policy_success_case "release verify tag match" "verify_tag=pass" \
    release-verify-tag --tag v0.1.0 --package-files "$package_files" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_release_verify_tag_mismatch_case() {
  local git_tag="$1"
  local package_version="$2"
  local changelog_heading="$3"
  local reason="$4"
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "$package_version" "$package_version" "$changelog_heading"
  package_files=$(release_metadata_package_files "$root")

  run_ci_policy_failure_case "release verify tag mismatch ${reason}" "$reason" \
    release-verify-tag --tag "$git_tag" --package-files "$package_files" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_release_verify_missing_changelog_case() {
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "0.1.0" "0.1.0" "## [0.1.1]"
  package_files=$(release_metadata_package_files "$root")

  run_ci_policy_failure_case "release verify missing changelog" "missing changelog section ## [0.1.0]" \
    release-verify-tag --tag v0.1.0 --package-files "$package_files" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_release_verify_mixed_package_versions_case() {
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "0.1.0" "0.1.1" "## [0.1.0]"
  package_files=$(release_metadata_package_files "$root")

  run_ci_policy_failure_case "release verify mixed package versions" "apps/community-bot version 0.1.1 does not match tag v0.1.0" \
    release-verify-tag --tag v0.1.0 --package-files "$package_files" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_release_verify_tag_normalization_case() {
  local git_tag="$1"
  local outcome="$2"
  local reason="$3"
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "0.1.0" "0.1.0" "## [0.1.0]"
  package_files=$(release_metadata_package_files "$root")

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "release verify tag normalization ${git_tag}" "boundary_reason=${reason}" \
      release-verify-tag --tag "$git_tag" --package-files "$package_files" --changelog "$root/CHANGELOG.md"
  else
    run_ci_policy_failure_case "release verify tag normalization ${git_tag}" "$reason" \
      release-verify-tag --tag "$git_tag" --package-files "$package_files" --changelog "$root/CHANGELOG.md"
  fi

  rm -rf "$root"
}

run_release_extract_notes_malformed_heading_case() {
  local heading="$1"
  local label="$2"
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given the engineer wrote the heading "<heading>"
  cat >"$changelog_path" <<MD
# Changelog

## [Unreleased]

${heading}

### Added

- Some release note.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the release workflow extracts release notes (via release-extract-notes)
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the extraction fails with the error "Missing changelog section ## [0.1.0]"
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes malformed-heading '${label}': expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "Missing changelog section ## [0.1.0]"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes malformed-heading '${label}': missing 'Missing changelog section ## [0.1.0]' error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_retag_force_overwrite_case() {
  local root tag_type tag_subject tag_commit head_commit
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".wrong"
    git add .wrong
    git commit --quiet -m "chore(release): v0.1.0"
    # Given the engineer previously ran `git tag -a v0.1.0 -m "Release v0.1.0"` on the wrong commit
    git tag -a v0.1.0 -m "Release v0.1.0"

    : >".fix"
    git add .fix
    git commit --quiet --amend --no-edit

    # When the engineer runs `git tag -f -a v0.1.0 -m "Release v0.1.0"` on the corrected HEAD
    git tag -f -a v0.1.0 -m "Release v0.1.0" >/dev/null
  )

  tag_type=$(cd "$root" && git cat-file -t v0.1.0)
  tag_subject=$(cd "$root" && git tag -l --format='%(contents:subject)' v0.1.0)
  tag_commit=$(cd "$root" && git rev-parse 'v0.1.0^{commit}')
  head_commit=$(cd "$root" && git rev-parse HEAD)

  if [ "$tag_type" != "tag" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-force-overwrite: cat-file -t outputs '${tag_type}', expected 'tag'"
    rm -rf "$root"
    return
  fi
  if [ "$tag_subject" != "Release v0.1.0" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-force-overwrite: tag subject is '${tag_subject}', expected 'Release v0.1.0'"
    rm -rf "$root"
    return
  fi
  if [ "$tag_commit" != "$head_commit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-force-overwrite: tag commit ${tag_commit} != HEAD ${head_commit}"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_retag_delete_recreate_case() {
  local root wrong_commit head_commit tag_type tag_subject tag_commit
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".wrong"
    git add .wrong
    # Given the engineer previously ran `git tag -a v0.1.0 -m "Release v0.1.0"` on the wrong commit
    git commit --quiet -m "chore(release): v0.1.0"
    git tag -a v0.1.0 -m "Release v0.1.0"

    : >".fix"
    git add .fix
    git commit --quiet --amend --no-edit
    # Note: the tag still points at the original (now stale) commit; HEAD has moved.

    # When the engineer runs `git tag -d v0.1.0`
    git tag -d v0.1.0 >/dev/null
    # And the engineer runs `git tag -a v0.1.0 -m "Release v0.1.0"` on the corrected HEAD
    git tag -a v0.1.0 -m "Release v0.1.0"
  )

  tag_type=$(cd "$root" && git cat-file -t v0.1.0)
  tag_subject=$(cd "$root" && git tag -l --format='%(contents:subject)' v0.1.0)
  tag_commit=$(cd "$root" && git rev-parse 'v0.1.0^{commit}')
  head_commit=$(cd "$root" && git rev-parse HEAD)

  # Then `git cat-file -t v0.1.0` outputs "tag"
  if [ "$tag_type" != "tag" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-delete-recreate: cat-file -t outputs '${tag_type}', expected 'tag'"
    rm -rf "$root"
    return
  fi

  # And `git tag -l --format="%(contents:subject)" v0.1.0` outputs "Release v0.1.0"
  if [ "$tag_subject" != "Release v0.1.0" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-delete-recreate: tag subject is '${tag_subject}', expected 'Release v0.1.0'"
    rm -rf "$root"
    return
  fi

  # And `git rev-parse v0.1.0^{commit}` matches `git rev-parse HEAD`
  if [ "$tag_commit" != "$head_commit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-retag-delete-recreate: tag commit ${tag_commit} != HEAD ${head_commit}"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_tag_version_mismatch_case() {
  local root package_files tag_type stdout stderr stdout_file stderr_file ec
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".bump"
    git add .bump
    git commit --quiet -m "chore(release): v0.1.0"
    # When the engineer runs `git tag -a v0.2.0 -m "Release v0.2.0"`
    git tag -a v0.2.0 -m "Release v0.2.0"
  )

  tag_type=$(cd "$root" && git cat-file -t v0.2.0)
  if [ "$tag_type" != "tag" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-tag-version-mismatch: v0.2.0 should be an annotated tag (got '${tag_type}')"
    rm -rf "$root"
    return
  fi

  package_files=$(release_metadata_package_files "$root")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Then release-verify-tag with --tag v0.2.0 against packages at 0.1.0 exits non-zero
  node "$SCRIPT" release-verify-tag \
    --tag v0.2.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-tag-version-mismatch: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-tag-version-mismatch: missing verify_tag=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "version"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-tag-version-mismatch: stderr missing version-mismatch hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_commit_subject_wrong_case() {
  local root subject stdout stderr stdout_file stderr_file ec
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".bump"
    git add .bump
    # When the engineer runs `git commit -m "release 0.1.0"`
    git commit --quiet -m "release 0.1.0"
    git tag -a v0.1.0 -m "Release v0.1.0"
  )

  subject=$(cd "$root" && git log -1 --pretty=%s)
  if [ "$subject" != "release 0.1.0" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject wrong: HEAD subject is '${subject}', expected 'release 0.1.0'"
    rm -rf "$root"
    return
  fi

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-verify-commit-subject \
    --tag v0.1.0 \
    --repo "$root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject wrong: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_commit_subject=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject wrong: missing verify_commit_subject=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "Commit subject must equal chore(release): v0.1.0"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject wrong: missing remediation hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_commit_subject_correct_case() {
  local root stdout stderr stdout_file stderr_file ec
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".bump"
    git add .bump
    git commit --quiet -m "chore(release): v0.1.0"
    git tag -a v0.1.0 -m "Release v0.1.0"
  )

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-verify-commit-subject \
    --tag v0.1.0 \
    --repo "$root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject correct: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_commit_subject=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-commit-subject correct: missing verify_commit_subject=pass
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_annotation_lightweight_case() {
  local root tag_type stdout stderr stdout_file stderr_file ec
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".bump"
    git add .bump
    git commit --quiet -m "chore(release): v0.1.0"
    # When the engineer runs `git tag v0.1.0` without the -a flag
    git tag v0.1.0
  )

  tag_type=$(cd "$root" && git cat-file -t v0.1.0)

  # Then `git cat-file -t v0.1.0` outputs "commit"
  if [ "$tag_type" != "commit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation lightweight: cat-file -t outputs '${tag_type}', expected 'commit'"
    rm -rf "$root"
    return
  fi

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # And the rule R-04 verifier flags the lightweight tag
  node "$SCRIPT" release-verify-tag-annotation \
    --tag v0.1.0 \
    --repo "$root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation lightweight: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag_annotation=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation lightweight: missing verify_tag_annotation=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the remediation hint reads "Recreate the tag with git tag -a v0.1.0 -m \"Release v0.1.0\""
  if ! printf '%s\n' "$stderr" | grep -Fq 'Recreate the tag with git tag -a v0.1.0 -m "Release v0.1.0"'; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation lightweight: missing remediation hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_annotation_annotated_case() {
  local root stdout stderr stdout_file stderr_file ec
  root=$(mktemp -d)
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    : >".bump"
    git add .bump
    git commit --quiet -m "chore(release): v0.1.0"
    git tag -a v0.1.0 -m "Release v0.1.0"
  )

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-verify-tag-annotation \
    --tag v0.1.0 \
    --repo "$root" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation annotated: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag_annotation=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag-annotation annotated: missing verify_tag_annotation=pass
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

setup_release_tag_workspace() {
  local root="$1"

  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"
  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "0.1.0" }\n' >"$root/${package_path}/package.json"
  done
  printf '{ "version": "0.1.0" }\n' >"$root/apps/community-bot/package.json"
  cat >"$root/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

### Added

- Release entry.
MD

  (
    cd "$root"
    git init --quiet --initial-branch=main
    git config user.email "atdd@sovri.test"
    git config user.name "ATDD"
    git config commit.gpgsign false
    git config tag.gpgsign false
    git add .
    git commit --quiet -m "chore(release): prepare v0.1.0"
  )
}

run_release_commit_and_annotated_tag_case() {
  local root subject tag_type tag_subject head_sha
  root=$(mktemp -d)

  # Given every package + apps/community-bot reports 0.1.0
  # And CHANGELOG.md contains "## [0.1.0] - 2026-05-23"
  setup_release_tag_workspace "$root"

  (
    cd "$root"
    # When the engineer runs `git commit -m "chore(release): v0.1.0"`
    : >".bump"
    git add .bump
    git commit --quiet -m "chore(release): v0.1.0"
    # And the engineer runs `git tag -a v0.1.0 -m "Release v0.1.0"`
    git tag -a v0.1.0 -m "Release v0.1.0"
  )

  subject=$(cd "$root" && git log -1 --pretty=%s)
  tag_type=$(cd "$root" && git cat-file -t v0.1.0)
  tag_subject=$(cd "$root" && git tag -l --format='%(contents:subject)' v0.1.0)
  head_sha=$(cd "$root" && git rev-parse HEAD)

  # Then `git log -1 --pretty=%s` outputs exactly "chore(release): v0.1.0"
  if [ "$subject" != "chore(release): v0.1.0" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: HEAD subject is '${subject}', expected 'chore(release): v0.1.0'"
    rm -rf "$root"
    return
  fi

  # And `git cat-file -t v0.1.0` outputs "tag"
  if [ "$tag_type" != "tag" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: tag type is '${tag_type}', expected 'tag' (annotated)"
    rm -rf "$root"
    return
  fi

  # And `git tag -l --format="%(contents:subject)" v0.1.0` outputs "Release v0.1.0"
  if [ "$tag_subject" != "Release v0.1.0" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: tag subject is '${tag_subject}', expected 'Release v0.1.0'"
    rm -rf "$root"
    return
  fi

  if [ -z "$head_sha" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: HEAD has no SHA"
    rm -rf "$root"
    return
  fi

  # And `release-verify-tag` accepts the workspace produced by the procedure
  local package_files verify_stdout verify_stderr verify_stdout_file verify_stderr_file verify_ec
  package_files=$(release_metadata_package_files "$root")
  verify_stdout_file=$(mktemp)
  verify_stderr_file=$(mktemp)
  node "$SCRIPT" release-verify-tag \
    --tag v0.1.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$verify_stdout_file" 2>"$verify_stderr_file" && verify_ec=0 || verify_ec=$?
  verify_stdout=$(cat "$verify_stdout_file" 2>/dev/null || true)
  verify_stderr=$(cat "$verify_stderr_file" 2>/dev/null || true)
  rm -f "$verify_stdout_file" "$verify_stderr_file"

  if [ "$verify_ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: release-verify-tag rejected the post-state
      stdout:
$(printf '%s\n' "$verify_stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$verify_stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$verify_stdout" | grep -Fq "verify_tag=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-commit-and-annotated-tag: missing verify_tag=pass after the release procedure
$(printf '%s\n' "$verify_stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_wrong_repo_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given "README.md" contains `docker pull ghcr.io/mpiton/community-bot:v0.2.0`
  cat >"$readme_path" <<'MD'
# Some Project

## Install

```bash
docker pull ghcr.io/mpiton/community-bot:v0.2.0
```

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the release engineer verifies the documentation
  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.2.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the rule R-02 is reported as violated
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release wrong-repo: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "readme_references_release=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release wrong-repo: missing readme_references_release=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the remediation hint reads "Repository path must be ghcr.io/mpiton/sovri/community-bot"
  if ! printf '%s\n' "$stderr" | grep -Fq "Repository path must be ghcr.io/mpiton/sovri/community-bot"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release wrong-repo: missing 'Repository path must be ...' hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_latest_only_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given "README.md" instructs users to run `docker pull ghcr.io/mpiton/sovri/community-bot:latest`
  # And "README.md" does not contain the string "v0.2.0"
  cat >"$readme_path" <<'MD'
# Some Project

## Install

```bash
docker pull ghcr.io/mpiton/sovri/community-bot:latest
```

End of file.
MD

  if grep -Fq "v0.2.0" "$readme_path"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release latest-only: fixture unexpectedly contains 'v0.2.0'"
    rm -rf "$root"
    return
  fi

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the release engineer verifies the documentation
  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.2.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the rule R-02 is reported as violated (signal: readme_references_release=fail)
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release latest-only: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "readme_references_release=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release latest-only: missing readme_references_release=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the remediation hint reads "Add a docker pull snippet pinned to v0.2.0 in README.md"
  if ! printf '%s\n' "$stderr" | grep -Fq "Add a docker pull snippet pinned to v0.2.0 in"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release latest-only: missing remediation hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_crlf_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a CRLF-encoded README where the docker pull snippet sits inside a
  # closed fenced block and the actual `## Install` heading follows after it.
  # The heading scan must still close the fence on the CRLF closing line.
  printf '# Some Project\r\n\r\n```\r\necho "preamble"\r\n```\r\n\r\n## Install\r\n\r\n```bash\r\ndocker pull ghcr.io/mpiton/sovri/community-bot:v0.2.0\r\n```\r\n' >"$readme_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.2.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release crlf: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "readme_references_release=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release crlf: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_newline_suffix_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG with a two-line `## [0.1.0]\n- 2026-05-23` malformed
  # heading. The date suffix lives on its own line so the heading is not a
  # valid `## [X.Y.Z] - YYYY-MM-DD`; both release-verify-tag and
  # release-extract-notes must reject it instead of treating
  # `- 2026-05-23` as the start of the release body.
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0]
- 2026-05-23

### Added

- Some entry.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes newline-suffix: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "Missing changelog section ## [0.1.0]"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes newline-suffix: missing 'Missing changelog section ## [0.1.0]' error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_longer_fence_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README whose fence is opened with FOUR backticks and contains an
  # inner THREE-backtick line plus a fake `## Install`. CommonMark requires the
  # closer to have at least as many markers as the opener, so the inner ```
  # must not close the block.
  cat >"$readme_path" <<'MD'
# Some Project

````markdown
```text
## Install
```

docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
````

```bash
docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
```

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release longer-fence: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release longer-fence: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_closing_fence_info_string_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README whose only `## Install` heading lives inside a fenced block,
  # and a candidate closing fence carries an info string. CommonMark rejects
  # closers with trailing info, so the fenced block must stay open and the
  # inner `## Install` must not be promoted to a real heading.
  cat >"$readme_path" <<'MD'
# Some Project

```
## Install
```javascript

docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
```

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release closing-fence-info-string: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release closing-fence-info-string: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_mixed_fence_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README whose backtick-fenced block contains a `~~~` line and a fake `## Install`
  # The matching-delimiter rule requires the backtick fence to stay open across the
  # tilde line, so the inner `## Install` must not be treated as a real Markdown heading.
  cat >"$readme_path" <<'MD'
# Some Project

```markdown
~~~
## Install

docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
~~~
```

```bash
docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
```

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release mixed-fence: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release mixed-fence: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_tilde_fenced_heading_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README whose only "## Install" line lives inside a tilde-fenced code block
  cat >"$readme_path" <<'MD'
# Some Project

The author shows what the heading should look like inside a tilde fence:

~~~markdown
## Install

docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
~~~

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release tilde-fenced-heading: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release tilde-fenced-heading: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_fenced_heading_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README whose only "## Install" line lives inside a fenced code block
  cat >"$readme_path" <<'MD'
# Some Project

The author shows what the heading should look like but never inserts a real one:

```markdown
## Install

docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
```

End of file.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release fenced-heading: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release fenced-heading: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_inline_mention_case() {
  local root readme_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  readme_path="$root/README.md"

  # Given a README that mentions "## Install" inline but has no real Markdown heading
  cat >"$readme_path" <<'MD'
# Some Project

The phrase "## Install" should exist as a heading in this file, but the author
never converted it into one. The docker snippet is present below.

```bash
docker pull ghcr.io/mpiton/sovri/community-bot:v0.1.0
```
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then readme-references-release must reject the file because there is no actual heading
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release inline-mention: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "readme_references_release=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release inline-mention: missing readme_references_release=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "## Install"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release inline-mention: missing install heading hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_readme_references_release_nominal_case() {
  local stdout stderr stdout_file stderr_file ec
  local repo_root="${SCRIPT_DIR%/scripts}"
  local readme_path="$repo_root/README.md"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When a contributor opens "README.md" on the default branch
  node "$SCRIPT" readme-references-release \
    --readme "$readme_path" \
    --image ghcr.io/mpiton/sovri/community-bot \
    --version 0.2.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the file contains the literal snippet `docker pull ghcr.io/mpiton/sovri/community-bot:v0.2.0`
  # And the file contains the section heading "## Install" within the first 200 lines.
  # Both assertions are wrapped inside the readme-references-release subcommand and surface
  # as exit 0 + `readme_references_release=pass` on success.
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release nominal: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "readme_references_release=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ readme-references-release nominal: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_release_extract_notes_release_notes_md_case() {
  local root changelog_path notes_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"
  notes_path="$root/release-notes.md"

  # Given "CHANGELOG.md" contains the heading "## [0.1.0] - 2026-05-23" followed by entries
  # and the next "## [" heading immediately follows the section body
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

### Added

- First promoted entry for v0.1.0.
- Second promoted entry for v0.1.0.

### Fixed

- A fix that belongs in v0.1.0.

## [0.0.1] - 2026-01-01

### Added

- Initial release.

## [0.0.0] - 2025-12-15

- Bootstrap.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the workflow extracts release notes for tag "v0.1.0"
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    >"$notes_path" 2>"$stderr_file" && ec=0 || ec=$?

  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes release-notes.md: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then the extracted "release-notes.md" is non-empty
  if [ ! -s "$notes_path" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes release-notes.md: file is empty"
    rm -rf "$root"
    return
  fi

  # And the extracted notes stop before the next "## [" heading
  if grep -Eq '^## \[' "$notes_path"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes release-notes.md: leaked a '## [' heading into the extracted notes
$(sed 's/^/        /' "$notes_path")"
    rm -rf "$root"
    return
  fi

  # And the body of [0.1.0] is fully present
  for needle in \
    "- First promoted entry for v0.1.0." \
    "- Second promoted entry for v0.1.0." \
    "- A fix that belongs in v0.1.0."; do
    if ! grep -Fq -- "$needle" "$notes_path"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ release-extract-notes release-notes.md: missing entry '${needle}'
$(sed 's/^/        /' "$notes_path")"
      rm -rf "$root"
      return
    fi
  done

  # And the prior version section is NOT in the extracted notes
  for forbidden in "- Initial release." "- Bootstrap."; do
    if grep -Fq -- "$forbidden" "$notes_path"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ release-extract-notes release-notes.md: prior-version content leaked '${forbidden}'
$(sed 's/^/        /' "$notes_path")"
      rm -rf "$root"
      return
    fi
  done

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_nominal_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

### Added

- Promoted entry one.
- Promoted entry two.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes nominal: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "Promoted entry one."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes nominal: missing 'Promoted entry one.' in extracted notes
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "Promoted entry two."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes nominal: missing 'Promoted entry two.' in extracted notes
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "Initial release."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes nominal: leaked 'Initial release.' from prior version section
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_under_cap_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG with a release body well below the byte cap
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

### Added

- Short entry one.
- Short entry two.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the workflow extracts release notes with --max-bytes 100000
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 100000 \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes under-cap: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then no truncation notice appears
  if printf '%s\n' "$stdout" | grep -Fq "Release notes truncated"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes under-cap: truncation notice unexpectedly present
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And both entries are present
  for needle in "Short entry one." "Short entry two."; do
    if ! printf '%s\n' "$stdout" | grep -Fq -- "$needle"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes under-cap: missing entry '${needle}'
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
      rm -rf "$root"
      return
    fi
  done

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_over_cap_with_repo_url_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG whose [0.1.0] body exceeds --max-bytes 1000
  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "- Padding entry that bloats the release section past one kilobyte." }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '%s\n' "$filler"
    printf '\n- Tail entry for v0.1.0.\n\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the workflow extracts release notes with a tight --max-bytes cap and repo URL
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 1000 \
    --repo-url https://github.com/mpiton/sovri \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  local bytes
  bytes=$(wc -c <"$stdout_file")
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap with repo: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then the truncation notice is present
  if ! printf '%s\n' "$stdout" | grep -Fq "Release notes truncated"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap with repo: missing truncation notice
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the notice contains a link to the full v0.1.0 changelog at the tag
  local expected_link="https://github.com/mpiton/sovri/blob/v0.1.0/CHANGELOG.md#010---2026-05-23"
  if ! printf '%s\n' "$stdout" | grep -Fq -- "$expected_link"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap with repo: missing expected link '${expected_link}'
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the output file does not exceed --max-bytes 1000
  if [ "$bytes" -gt 1000 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap with repo: output is ${bytes} bytes, expected ≤ 1000"
    rm -rf "$root"
    return
  fi

  # And the prior-version section did not leak into the truncated output
  if printf '%s\n' "$stdout" | grep -Fq "Initial release."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap with repo: leaked prior-version content"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_over_cap_without_repo_url_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "- Padding entry without a repository URL provided." }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '%s\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When --max-bytes triggers truncation but --repo-url is omitted
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 800 \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  local bytes
  bytes=$(wc -c <"$stdout_file")
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap no-repo: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then the truncation notice is present without a link
  if ! printf '%s\n' "$stdout" | grep -Fq "Release notes truncated"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap no-repo: missing truncation notice
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "https://"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap no-repo: unexpected URL in notice"
    rm -rf "$root"
    return
  fi

  if [ "$bytes" -gt 800 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes over-cap no-repo: output is ${bytes} bytes, expected ≤ 800"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_rejects_invalid_value_case() {
  local invalid_value="$1"
  local label="$2"
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

- Body entry.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When --max-bytes is given a non-positive-integer value
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes "$invalid_value" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes invalid '${label}': expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq -- "--max-bytes"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes invalid '${label}': missing '--max-bytes' diagnostic
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_rejects_invalid_repo_url_case() {
  local invalid_url="$1"
  local label="$2"
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

- Body entry.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When --repo-url is given a non-http(s) value or a value containing ')'
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 1000 \
    --repo-url "$invalid_url" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes repo-url invalid '${label}': expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq -- "--repo-url"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes repo-url invalid '${label}': missing '--repo-url' diagnostic
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_boundary_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec body_size cap

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG with a known [0.1.0] body
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-05-23

- Short entry one.
- Short entry two.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  # Measure the file size of the extracted body in passthrough mode (includes
  # the trailing newline writeStdout always appends). Fail fast if the setup
  # call exits non-zero so an invalid body_size cannot mask later regressions.
  local passthrough_file passthrough_stderr_file passthrough_ec passthrough_stderr
  passthrough_file=$(mktemp)
  passthrough_stderr_file=$(mktemp)
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    >"$passthrough_file" 2>"$passthrough_stderr_file" && passthrough_ec=0 || passthrough_ec=$?
  if [ "$passthrough_ec" -ne 0 ]; then
    passthrough_stderr=$(cat "$passthrough_stderr_file" 2>/dev/null || true)
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes boundary setup: passthrough extraction failed with exit ${passthrough_ec}
$(printf '%s\n' "$passthrough_stderr" | sed 's/^/        /')"
    rm -f "$passthrough_file" "$passthrough_stderr_file"
    rm -rf "$root"
    return
  fi
  body_size=$(wc -c <"$passthrough_file")
  rm -f "$passthrough_file" "$passthrough_stderr_file"

  # When --max-bytes is exactly equal to the passthrough file size, the body
  # already fits and no truncation occurs.
  cap="$body_size"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes "$cap" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes boundary equal: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if printf '%s\n' "$stdout" | grep -Fq "Release notes truncated"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes boundary equal: unexpected truncation when body equals cap"
    rm -rf "$root"
    return
  fi

  # When --max-bytes is exactly body_size - 1, truncation triggers
  cap=$((body_size - 1))
  if [ "$cap" -lt 200 ]; then
    # Notice is ~120 bytes; below 200 the truncation guard fires and we cannot assert behavior.
    PASS=$((PASS + 1))
    rm -rf "$root"
    return
  fi

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes "$cap" \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes boundary below: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "Release notes truncated"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes boundary below: missing truncation notice when body exceeds cap by 1"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_fence_marker_with_trailing_text_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # CommonMark closing fences must be followed only by whitespace. A line that
  # starts with more backticks but has trailing text is content, not a closer.
  # If `closeDanglingCodeFence` treats such a line as a closer, the
  # truncation notice ends up rendered inside an unclosed code block.
  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "\`\`\`\`oops still content not a closer" }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '```text\n%s\n```\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 800 \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes fence-trailing-text: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Lines with trailing content after backticks must not be mistaken for a
  # closer. The opener `` ```text `` is cut by truncation, so a bare ``` closer
  # must be appended before the truncation notice; otherwise the notice ends
  # up rendered inside an unclosed code block.
  if ! printf '%s\n' "$stdout" | awk '
    /Release notes truncated/ { print found; exit }
    /^ {0,3}`{3,}[[:space:]]*$/ { found = 1 }
    END { if (!found) print 0 }
  ' | grep -q '^1$'; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes fence-trailing-text: truncation notice not preceded by a bare \`\`\` closer
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_indented_fence_closure_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # CommonMark allows fenced code blocks indented up to three spaces (e.g.
  # nested under a list item). The fence detector must spot indented fences
  # so it can append a closer when truncation cuts inside one.
  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "      indented filler line that bloats the section" }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf -- '- list item with an indented fenced block:\n\n   ```text\n%s\n   ```\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 600 \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes indented-fence closure: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Indented backtick fences (up to 3 leading spaces) are recognised, so the
  # final output keeps the markers in matched pairs.
  local fence_count
  fence_count=$(printf '%s' "$stdout" | grep -cE '^ {0,3}```' || true)
  if [ $((fence_count % 2)) -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes indented-fence closure: dangling indented code fence (${fence_count} markers)
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_tilde_fence_closure_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "  tilde-fenced filler line that bloats the section;" }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '~~~text\n%s\n~~~\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 600 \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes tilde-fence closure: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then tilde-fence markers come in matched pairs (no dangling open fence)
  local tilde_count
  tilde_count=$(printf '%s' "$stdout" | grep -cE '^~~~' || true)
  if [ $((tilde_count % 2)) -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes tilde-fence closure: dangling tilde fence (${tilde_count} markers)
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_fence_does_not_overflow_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec bytes filler cap

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a release body whose truncation-safe cut lands near a newline while a
  # code fence is still open. Use single-character lines so safeHead lands close
  # to the budget; without the post-closure re-trim the fence closer pushes the
  # final output bytes past --max-bytes.
  filler=$(awk 'BEGIN { for (i = 0; i < 500; i++) print "x" }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '```text\n%s\n```\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  cap=300
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes "$cap" \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  bytes=$(wc -c <"$stdout_file")
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes fence-no-overflow: expected exit 0, got ${ec}
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # The whole file (including the trailing newline writeStdout appends) must fit the cap.
  if [ "$bytes" -gt "$cap" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes fence-no-overflow: output is ${bytes} bytes, expected ≤ ${cap}
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Fence markers still come in matched pairs (closure ran).
  local fence_count
  fence_count=$(printf '%s' "$stdout" | grep -cE '^```' || true)
  if [ $((fence_count % 2)) -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes fence-no-overflow: dangling code fence (${fence_count} markers)
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_extract_notes_max_bytes_closes_open_fence_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec filler

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a release body whose only truncation-safe cut lands inside a code fence
  filler=$(awk 'BEGIN { for (i = 0; i < 60; i++) print "  filler line inside the fenced block;" }')

  {
    printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-05-23\n\n### Added\n\n'
    printf '```text\n%s\n```\n' "$filler"
    printf '\n## [0.0.1] - 2026-01-01\n\n- Initial release.\n'
  } >"$changelog_path"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-extract-notes \
    --changelog "$changelog_path" \
    --version 0.1.0 \
    --max-bytes 600 \
    --repo-url https://github.com/example/repo \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes fence-closure: expected exit 0, got ${ec}
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # Then code-fence markers come in matched pairs (no dangling open fence)
  local fence_count
  fence_count=$(printf '%s' "$stdout" | grep -cE '^```' || true)
  if [ $((fence_count % 2)) -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-extract-notes max-bytes fence-closure: dangling code fence (${fence_count} markers)
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_unreleased_populated_marker_case() {
  local bullet_marker="$1"
  local marker_label="$2"
  local root package_files stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"
  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "0.1.0" }\n' >"$root/${package_path}/package.json"
  done
  printf '{ "version": "0.1.0" }\n' >"$root/apps/community-bot/package.json"

  # Given the engineer added "## [0.1.0] - 2026-05-23" but did not move any entry
  # And "## [Unreleased]" still contains a populated entry using the given Markdown bullet marker
  cat >"$root/CHANGELOG.md" <<MD
# Changelog

## [Unreleased]

### Added

${bullet_marker} Forgotten entry using ${marker_label} bullet.

## [0.1.0] - 2026-05-23

MD
  package_files=$(release_metadata_package_files "$root")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  node "$SCRIPT" release-verify-tag \
    --tag v0.1.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag unreleased-populated-marker '${bullet_marker}': expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "[Unreleased] still has entries after release section"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag unreleased-populated-marker '${bullet_marker}': missing populated-Unreleased error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_empty_unreleased_refusal_case() {
  local root package_files stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"
  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "0.1.0" }\n' >"$root/${package_path}/package.json"
  done
  printf '{ "version": "0.1.0" }\n' >"$root/apps/community-bot/package.json"

  # Given "CHANGELOG.md" contains "## [Unreleased]" followed by zero bullet entries
  # And the engineer attempts to tag "v0.1.0" (so no `## [0.1.0]` section exists yet)
  cat >"$root/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

## [0.0.1] - 2026-01-01

- Initial release.
MD
  package_files=$(release_metadata_package_files "$root")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer runs `node scripts/ci-policy.mjs release-verify-tag --tag v0.1.0 ...`
  node "$SCRIPT" release-verify-tag \
    --tag v0.1.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the command exits with a non-zero status
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag empty-unreleased-refusal: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag empty-unreleased-refusal: missing verify_tag=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the error contains the string "Refusing to release with empty Unreleased"
  if ! printf '%s\n' "$stderr" | grep -Fq "Refusing to release with empty Unreleased"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag empty-unreleased-refusal: missing 'Refusing to release with empty Unreleased' error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the remediation hint reads "Add at least one bullet under [Unreleased] before tagging"
  if ! printf '%s\n' "$stderr" | grep -Fq "Add at least one bullet under [Unreleased] before tagging"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag empty-unreleased-refusal: missing remediation hint
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_unreleased_still_populated_case() {
  local root package_files stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"
  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "0.1.0" }\n' >"$root/${package_path}/package.json"
  done
  printf '{ "version": "0.1.0" }\n' >"$root/apps/community-bot/package.json"

  # Given the engineer added "## [0.1.0] - 2026-05-23" but did not move any entry
  # And "## [Unreleased]" still contains 12 bullet entries
  cat >"$root/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

### Added

- Entry one.
- Entry two.
- Entry three.
- Entry four.
- Entry five.
- Entry six.
- Entry seven.
- Entry eight.
- Entry nine.
- Entry ten.
- Entry eleven.
- Entry twelve.

## [0.1.0] - 2026-05-23

MD
  package_files=$(release_metadata_package_files "$root")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer runs `node scripts/ci-policy.mjs release-verify-tag --tag v0.1.0 ...`
  node "$SCRIPT" release-verify-tag \
    --tag v0.1.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the command exits with a non-zero status
  if [ "$ec" -eq 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag unreleased-still-populated: expected non-zero exit, got 0
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the rule R-03 is reported as violated (signal: verify_tag=fail on stdout)
  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag unreleased-still-populated: missing verify_tag=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "[Unreleased] still has entries after release section"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ release-verify-tag unreleased-still-populated: missing populated-Unreleased error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_release_verify_tag_format_case() {
  local git_tag="$1"
  local root package_files

  root=$(mktemp -d)
  write_release_metadata_fixture "$root" "0.1.0" "0.1.0" "## [0.1.0]"
  package_files=$(release_metadata_package_files "$root")

  run_ci_policy_failure_case "release verify tag format ${git_tag}" "tag must use vX.Y.Z format" \
    release-verify-tag --tag "$git_tag" --package-files "$package_files" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_promote_changelog_nominal_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec promoted body_after_release body_after_unreleased

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given the prior "## [Unreleased]" section contains entries under "### Added"
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

### Added

- Foo widget shipped.
- Bar gadget configured.

## [0.0.1] - 2026-01-01

### Added

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer rewrites "CHANGELOG.md" for the v0.1.0 release
  node "$SCRIPT" promote-changelog \
    --version 0.1.0 \
    --date 2026-05-23 \
    --changelog "$changelog_path" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "promote_changelog=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: missing pass assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  promoted=$(cat "$changelog_path")

  # Then a section heading "## [0.1.0] - 2026-05-23" exists
  if ! printf '%s\n' "$promoted" | grep -Fxq "## [0.1.0] - 2026-05-23"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: missing release heading '## [0.1.0] - 2026-05-23'
$(printf '%s\n' "$promoted" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And every entry previously under "## [Unreleased]" appears under "## [0.1.0] - 2026-05-23"
  body_after_release=$(printf '%s\n' "$promoted" | awk '
    /^## \[0\.1\.0\] - 2026-05-23/ { in_release=1; next }
    /^## \[/ && in_release { in_release=0 }
    in_release { print }
  ')
  if ! printf '%s\n' "$body_after_release" | grep -Fq -- "- Foo widget shipped."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: 'Foo widget' entry not under [0.1.0] section
$(printf '%s\n' "$body_after_release" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi
  if ! printf '%s\n' "$body_after_release" | grep -Fq -- "- Bar gadget configured."; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: 'Bar gadget' entry not under [0.1.0] section
$(printf '%s\n' "$body_after_release" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the "## [Unreleased]" heading still exists and contains no bullet entries
  if ! printf '%s\n' "$promoted" | grep -Fxq "## [Unreleased]"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: '## [Unreleased]' heading missing
$(printf '%s\n' "$promoted" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi
  body_after_unreleased=$(printf '%s\n' "$promoted" | awk '
    /^## \[Unreleased\]/ { in_unreleased=1; next }
    /^## \[/ && in_unreleased { in_unreleased=0 }
    in_unreleased { print }
  ')
  if printf '%s\n' "$body_after_unreleased" | grep -Eq "^- "; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog nominal: [Unreleased] body still contains bullet entries
$(printf '%s\n' "$body_after_unreleased" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_promote_changelog_empty_unreleased_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec original_changelog

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG with an empty `## [Unreleased]` section
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

## [0.0.1] - 2026-01-01

- Initial release.
MD
  original_changelog=$(cat "$changelog_path")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer runs promote-changelog for v0.1.0
  node "$SCRIPT" promote-changelog \
    --version 0.1.0 \
    --date 2026-05-23 \
    --changelog "$changelog_path" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then promote-changelog refuses with a non-zero exit
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog empty-unreleased: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "promote_changelog=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog empty-unreleased: missing promote_changelog=fail
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And the error mentions "Refusing to release with empty Unreleased"
  if ! printf '%s\n' "$stderr" | grep -Fq "Refusing to release with empty Unreleased"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog empty-unreleased: missing 'Refusing to release with empty Unreleased' error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  # And CHANGELOG.md is not modified
  if [ "$(cat "$changelog_path")" != "$original_changelog" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog empty-unreleased: CHANGELOG.md was modified despite refusal"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_promote_changelog_duplicate_version_case() {
  local root changelog_path stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given the changelog already has a "## [0.1.0]" section from a previous run
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

### Added

- Foo widget shipped.

## [0.1.0] - 2026-05-22

### Added

- Earlier promotion artifact.

## [0.0.1] - 2026-01-01

- Initial release.
MD

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer re-runs promote-changelog for the same version
  node "$SCRIPT" promote-changelog \
    --version 0.1.0 \
    --date 2026-05-23 \
    --changelog "$changelog_path" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then promote-changelog refuses with a non-zero exit and a duplicate-version message
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog duplicate-version: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "promote_changelog=fail"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog duplicate-version: missing fail assertion
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "version 0.1.0 already has a section in changelog"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog duplicate-version: missing duplicate-version error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_promote_changelog_invalid_calendar_date_case() {
  local date="$1"
  local root changelog_path stdout stderr stdout_file stderr_file ec original_changelog

  root=$(mktemp -d)
  changelog_path="$root/CHANGELOG.md"

  # Given a CHANGELOG with an [Unreleased] entry ready for promotion
  cat >"$changelog_path" <<'MD'
# Changelog

## [Unreleased]

### Added

- Sample entry.
MD
  original_changelog=$(cat "$changelog_path")

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # When the engineer passes a date that is well-formed but not a real calendar date
  node "$SCRIPT" promote-changelog \
    --version 0.1.0 \
    --date "$date" \
    --changelog "$changelog_path" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then promote-changelog refuses without rewriting CHANGELOG.md
  if [ "$ec" -ne 1 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog invalid-calendar-date ${date}: expected exit 1, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stderr" | grep -Fq "date ${date} is not a valid calendar date"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog invalid-calendar-date ${date}: missing 'not a valid calendar date' error
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if [ "$(cat "$changelog_path")" != "$original_changelog" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-changelog invalid-calendar-date ${date}: CHANGELOG.md was modified despite failed validation"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

run_promote_changelog_then_verify_tag_case() {
  local root package_files stdout stderr stdout_file stderr_file ec

  root=$(mktemp -d)

  # Given a workspace with v0.1.0 in every package and a CHANGELOG with Unreleased entries
  mkdir -p "$root/packages/core" "$root/packages/review-engine" "$root/packages/llm-providers" \
    "$root/packages/config" "$root/packages/observability" "$root/apps/community-bot"
  for package_path in packages/core packages/review-engine packages/llm-providers packages/config packages/observability; do
    printf '{ "version": "0.1.0" }\n' >"$root/${package_path}/package.json"
  done
  printf '{ "version": "0.1.0" }\n' >"$root/apps/community-bot/package.json"
  cat >"$root/CHANGELOG.md" <<'MD'
# Changelog

## [Unreleased]

### Added

- Feature shipped.
MD
  package_files=$(release_metadata_package_files "$root")

  # When the engineer promotes Unreleased to [0.1.0] - 2026-05-23
  local promote_stdout_file promote_stderr_file promote_ec
  promote_stdout_file=$(mktemp)
  promote_stderr_file=$(mktemp)
  node "$SCRIPT" promote-changelog \
    --version 0.1.0 \
    --date 2026-05-23 \
    --changelog "$root/CHANGELOG.md" \
    >"$promote_stdout_file" 2>"$promote_stderr_file" && promote_ec=0 || promote_ec=$?
  if [ "$promote_ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-then-verify-tag: promote-changelog exited ${promote_ec}
      stdout:
$(sed 's/^/        /' "$promote_stdout_file")
      stderr:
$(sed 's/^/        /' "$promote_stderr_file")"
    rm -f "$promote_stdout_file" "$promote_stderr_file"
    rm -rf "$root"
    return
  fi
  rm -f "$promote_stdout_file" "$promote_stderr_file"

  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # And then runs release-verify-tag against the promoted CHANGELOG
  node "$SCRIPT" release-verify-tag \
    --tag v0.1.0 \
    --package-files "$package_files" \
    --changelog "$root/CHANGELOG.md" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then release-verify-tag passes (the dated heading is recognized as ## [0.1.0])
  if [ "$ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-then-verify-tag: expected exit 0, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')
      changelog:
$(cat "$root/CHANGELOG.md" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  if ! printf '%s\n' "$stdout" | grep -Fq "verify_tag=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ promote-then-verify-tag: missing verify_tag=pass
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    rm -rf "$root"
    return
  fi

  PASS=$((PASS + 1))
  rm -rf "$root"
}

write_release_build_workflow() {
  local workflow_file="$1"
  local push_value="$2"
  local platforms_value="$3"
  local tags_value="$4"
  local image_repository="$5"

  cat >"$workflow_file" <<YAML
name: Release
on:
  push:
    tags:
      - "v*"
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Build and push
        uses: docker/build-push-action@3b5e8027fcad23fda98b2e3ac259d8d67585f671
        with:
          push: ${push_value}
          platforms: ${platforms_value}
          tags: |
$(printf '%s\n' "$tags_value" | sed 's/^/            /')
          labels: org.opencontainers.image.source=${image_repository}
YAML
}

release_required_tags() {
  printf '%s\n' \
    "ghcr.io/mpiton/sovri/community-bot:v0.2.0" \
    "ghcr.io/mpiton/sovri/community-bot:v0.2" \
    "ghcr.io/mpiton/sovri/community-bot:v0" \
    "ghcr.io/mpiton/sovri/community-bot:latest"
}

run_release_build_and_push_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_build_workflow "$workflow_file" "true" "linux/amd64,linux/arm64" "$(release_required_tags)" "ghcr.io/mpiton/sovri/community-bot"

  run_ci_policy_success_case "release build-and-push" "release_build_and_push=pass" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_build_dynamic_tags_case() {
  local workflow_file dynamic_tags

  workflow_file=$(mktemp)
  dynamic_tags=$(printf '%s\n' \
    'ghcr.io/mpiton/sovri/community-bot:${{ steps.image-tags.outputs.full }}' \
    'ghcr.io/mpiton/sovri/community-bot:${{ steps.image-tags.outputs.minor }}' \
    'ghcr.io/mpiton/sovri/community-bot:${{ steps.image-tags.outputs.major }}' \
    'ghcr.io/mpiton/sovri/community-bot:latest')
  write_release_build_workflow "$workflow_file" "true" "linux/amd64,linux/arm64" "$dynamic_tags" "ghcr.io/mpiton/sovri/community-bot"

  run_ci_policy_success_case "release build-and-push dynamic tags" "release_build_and_push=pass" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_build_push_false_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_build_workflow "$workflow_file" "false" "linux/amd64,linux/arm64" "$(release_required_tags)" "ghcr.io/mpiton/sovri/community-bot"

  run_ci_policy_failure_case "release build-and-push false" "build-and-push must push release images" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_build_platform_boundary_case() {
  local platforms="$1"
  local outcome="$2"
  local reason="$3"
  local workflow_file

  workflow_file=$(mktemp)
  write_release_build_workflow "$workflow_file" "true" "$platforms" "$(release_required_tags)" "ghcr.io/mpiton/sovri/community-bot"

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "release build platform ${platforms}" "boundary_reason=${reason}" \
      release-build-and-push --workflow "$workflow_file"
  else
    run_ci_policy_failure_case "release build platform ${platforms}" "$reason" \
      release-build-and-push --workflow "$workflow_file"
  fi

  rm -f "$workflow_file"
}

run_release_build_missing_tag_case() {
  local missing_tag="$1"
  local workflow_file tags

  workflow_file=$(mktemp)
  tags=$(release_required_tags | grep -Fvx "ghcr.io/mpiton/sovri/community-bot:${missing_tag}" || true)
  write_release_build_workflow "$workflow_file" "true" "linux/amd64,linux/arm64" "$tags" "ghcr.io/mpiton/sovri/community-bot"

  run_ci_policy_failure_case "release build missing ${missing_tag}" "missing ${missing_tag} tag" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_build_missing_job_case() {
  local workflow_file

  workflow_file=$(mktemp)
  cat >"$workflow_file" <<'YAML'
name: Release
on:
  push:
    tags:
      - "v*"
jobs:
  verify-tag:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YAML

  run_ci_policy_failure_case "release build missing job" "missing build-and-push job" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

run_release_build_wrong_repo_case() {
  local workflow_file

  workflow_file=$(mktemp)
  write_release_build_workflow "$workflow_file" "true" "linux/amd64,linux/arm64" "$(printf '%s\n' "ghcr.io/mpiton/sovri/wrong-bot:v0.2.0" "ghcr.io/mpiton/sovri/wrong-bot:v0.2" "ghcr.io/mpiton/sovri/wrong-bot:v0" "ghcr.io/mpiton/sovri/wrong-bot:latest")" "ghcr.io/mpiton/sovri/wrong-bot"

  run_ci_policy_failure_case "release build wrong repo" "image repository must be ghcr.io/mpiton/sovri/community-bot" \
    release-build-and-push --workflow "$workflow_file"

  rm -f "$workflow_file"
}

write_cosign_fixture() {
  local root="$1"
  local changelog_heading="$2"
  local changelog_body="$3"
  local workflow_body="$4"

  mkdir -p "$root"
  # Auto-extend bare `## [X.Y.Z]` headings with the canonical dated form so the
  # release-heading regex (now date-required) accepts the fixture.
  local final_heading="$changelog_heading"
  if printf '%s' "$changelog_heading" | grep -Eq '^## \[[^]]+\]$'; then
    final_heading="$changelog_heading - 2026-05-23"
  fi
  printf '# Changelog\n\n%s\n%s\n\n## [Unreleased]\n%s\n' "$final_heading" "$changelog_body" "$changelog_body" >"$root/CHANGELOG.md"
  printf '%s\n' "$workflow_body" >"$root/release.yml"
}

run_cosign_deferral_pass_case() {
  local root

  root=$(mktemp -d)
  write_cosign_fixture "$root" "## [0.2.0]" "- Cosign signing remains deferred to v0.5." "jobs:
  build-and-push:
    steps:
      - run: echo unsigned"

  run_ci_policy_success_case "cosign deferral pass" "cosign_deferral=pass" \
    cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_cosign_missing_note_case() {
  local root

  root=$(mktemp -d)
  write_cosign_fixture "$root" "## [0.2.0]" "- Release without signing." "jobs:
  build-and-push:
    steps:
      - run: echo unsigned"

  run_ci_policy_failure_case "cosign missing note" "document cosign signing deferral to v0.5" \
    cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_cosign_outside_section_case() {
  local root

  root=$(mktemp -d)
  mkdir -p "$root"
  cat >"$root/CHANGELOG.md" <<'MARKDOWN'
# Changelog

## [0.2.0]
- Release without signing.

## [Unreleased]
- Cosign signing remains deferred to v0.5.
MARKDOWN
  printf 'jobs:\n  build-and-push:\n    steps:\n      - run: echo unsigned\n' >"$root/release.yml"

  run_ci_policy_failure_case "cosign outside section" "deferral must be documented in ## [0.2.0]" \
    cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_cosign_usage_case() {
  local cosign_usage="$1"
  local root

  root=$(mktemp -d)
  write_cosign_fixture "$root" "## [0.2.0]" "- Cosign signing remains deferred to v0.5." "jobs:
  build-and-push:
    steps:
      - run: ${cosign_usage}"

  run_ci_policy_failure_case "cosign usage ${cosign_usage}" "cosign signing is deferred to v0.5" \
    cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"

  rm -rf "$root"
}

run_cosign_deferred_version_boundary_case() {
  local deferred_version="$1"
  local outcome="$2"
  local reason="$3"
  local root

  root=$(mktemp -d)
  write_cosign_fixture "$root" "## [0.2.0]" "- Cosign signing remains deferred to ${deferred_version}." "jobs:
  build-and-push:
    steps:
      - run: echo unsigned"

  if [ "$outcome" = accepted ]; then
    run_ci_policy_success_case "cosign version ${deferred_version}" "boundary_reason=${reason}" \
      cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"
  else
    run_ci_policy_failure_case "cosign version ${deferred_version}" "$reason" \
      cosign-deferral --workflow "$root/release.yml" --changelog "$root/CHANGELOG.md"
  fi

  rm -rf "$root"
}

# Writes a minimal, valid backend-checks workflow that bootstraps pnpm before the
# setup-node cache, builds before typecheck, runs Vitest with coverage, and always
# wires the packages/llm-providers gate. When <gate_threshold> is non-empty it also
# wires a check-coverage gate for <package> at that threshold; pass "" to omit it.
write_package_coverage_workflow_fixture() {
  local file="$1" package="$2" gate_threshold="$3"
  {
    cat <<'HEAD'
name: CI

on:
  pull_request:

jobs:
  backend-checks:
    runs-on: ubuntu-latest
    steps:
      - name: Enable pnpm for setup-node cache
        run: corepack enable
      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - name: Build
        run: pnpm turbo build
      - name: Typecheck
        run: pnpm exec tsc -b
      - name: Run coverage
        run: pnpm exec vitest run --coverage --reporter=verbose
      - name: Coverage gate — packages/llm-providers ≥ 85 %
        run: node scripts/check-coverage.mjs coverage/coverage-summary.json packages/llm-providers 85
HEAD
    if [ -n "$gate_threshold" ]; then
      printf '      - name: Coverage gate — %s >= %s %%\n        run: node scripts/check-coverage.mjs coverage/coverage-summary.json %s %s\n' \
        "$package" "$gate_threshold" "$package" "$gate_threshold"
    fi
  } >"$file"
}

# Evaluates the package-coverage-workflow policy against the REAL repository ci.yml.
# Then the workflow must wire the <package> gate so the policy passes.
run_package_coverage_workflow_real_ci_case() {
  local package="$1" min="$2" expected_key="$3"
  local ci_yml stdout stderr stdout_file stderr_file ec
  ci_yml="$SCRIPT_DIR/../.github/workflows/ci.yml"
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  # Given the backend-checks job runs "pnpm exec vitest run --coverage" before any package gate
  # When the release engineer evaluates the <package> coverage workflow policy
  node "$SCRIPT" package-coverage-workflow --workflow "$ci_yml" \
    --package "$package" --branches "$min" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -f "$stdout_file" "$stderr_file"

  # Then the policy exits with code 0 and stdout includes "<key>=pass"
  if [ "$ec" -ne 0 ] || ! printf '%s\n' "$stdout" | grep -Fq "${expected_key}=pass"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${package} coverage gate must be wired in ci.yml at >= ${min}
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

# Evaluates the package-coverage-workflow policy against a fixture wired at
# <gate_threshold> (or omitted when empty) for <package> with minimum <min>.
run_package_coverage_workflow_case() {
  local label="$1" package="$2" min="$3" gate_threshold="$4" expected_exit="$5" expected_status="$6"
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-pkg-workflow')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)
  write_package_coverage_workflow_fixture "$tmp/ci.yml" "$package" "$gate_threshold"

  node "$SCRIPT" package-coverage-workflow --workflow "$tmp/ci.yml" \
    --package "$package" --branches "$min" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne "$expected_exit" ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "$expected_status"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ package coverage workflow ${label}: expected exit ${expected_exit} with ${expected_status}
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

# Evaluates the real coverage-gate command against a synthesized summary so the
# @technical branch (real package coverage stays at or above the threshold) is
# exercised without depending on a live coverage run.
run_package_coverage_gate_summary_case() {
  local label="$1" package="$2" min="$3" covered="$4" total="$5" expected_exit="$6" expected_status="$7"
  local tmp stdout stderr stdout_file stderr_file ec

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'ci-policy-pkg-coverage')
  stdout_file=$(mktemp)
  stderr_file=$(mktemp)

  mkdir -p "$tmp/coverage"
  cat >"$tmp/coverage/coverage-summary.json" <<EOF
{
  "total": {
    "branches": { "total": ${total}, "covered": ${covered}, "skipped": 0, "pct": 0 }
  },
  "/repo/${package}/src/index.ts": {
    "branches": { "total": ${total}, "covered": ${covered}, "skipped": 0, "pct": 0 },
    "lines": { "total": ${total}, "covered": ${total}, "skipped": 0, "pct": 100 }
  }
}
EOF

  node "$SCRIPT" coverage-gate \
    --input "$tmp/coverage/coverage-summary.json" \
    --package "$package" \
    --branches "$min" \
    >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)
  rm -rf "$tmp"
  rm -f "$stdout_file" "$stderr_file"

  if [ "$ec" -ne "$expected_exit" ] ||
    ! printf '%s\n' "$stdout" | grep -Fq "$expected_status"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ package coverage summary ${label}: expected exit ${expected_exit} with ${expected_status}
      exit: ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  PASS=$((PASS + 1))
}

run_duration_pass_case 180000 "180 s"
run_duration_pass_case 299999 "299.999 s"
run_secrets_duration_pass_case 15000 "15 s"
run_secrets_duration_pass_case 59999 "59.999 s"
run_secrets_duration_fail_case 60000
run_secrets_duration_fail_case 90000
run_secrets_duration_queue_exclusion_case
run_secrets_duration_counts_only_secrets_job_case
run_forbidden_jobs_duration_pass_case 12000 29999
run_forbidden_jobs_duration_fail_case 30000 12000 "forbidden-tools must finish in under 30 seconds"
run_forbidden_jobs_duration_fail_case 12000 45000 "forbidden-imports must finish in under 30 seconds"
run_forbidden_jobs_duration_fail_case 15000 30000 "forbidden-imports must finish in under 30 seconds"
run_forbidden_jobs_duration_fail_case 12000 missing "missing monitored job: forbidden-imports"
run_forbidden_jobs_duration_fail_case missing 18000 "missing monitored job: forbidden-tools"
run_forbidden_jobs_duration_fail_case 12000 unknown "missing duration evidence for forbidden-imports"
run_forbidden_jobs_duration_fail_case unknown 18000 "missing duration evidence for forbidden-tools"
run_build_docker_duration_pass_case 120000 "2 min"
run_build_docker_duration_pass_case 599999 "9 min 59.999 s"
run_build_docker_duration_fail_case 600000
run_build_docker_duration_fail_case 720000
run_build_docker_duration_excludes_queue_case
run_build_docker_duration_missing_cache_case
run_codeql_duration_pass_case 180000 "180 s"
run_codeql_duration_pass_case 479999 "479.999 s"
run_codeql_duration_fail_case 480000
run_codeql_duration_fail_case 600000
run_codeql_workflow_config_pass_case
run_codeql_workflow_missing_trigger_case "push main" "$(printf '%s\n' \
  "  pull_request:" \
  "  schedule:" \
  "    - cron: \"0 6 * * 1\"")" "CodeQL workflow must run on push to main"
run_codeql_workflow_missing_trigger_case "pull_request" "$(printf '%s\n' \
  "  push:" \
  "    branches:" \
  "      - main" \
  "  schedule:" \
  "    - cron: \"0 6 * * 1\"")" "CodeQL workflow must run on pull_request"
run_codeql_workflow_missing_trigger_case "schedule" "$(printf '%s\n' \
  "  push:" \
  "    branches:" \
  "      - main" \
  "  pull_request:")" "CodeQL workflow must run weekly"
run_codeql_workflow_cron_boundary_case "0 6 * * 1" accepted "weekly Monday scan at 06:00 UTC"
run_codeql_workflow_cron_boundary_case "0 5 * * 1" rejected "CodeQL weekly schedule must use 0 6 * * 1"
run_codeql_workflow_permission_case "contents write" "$(printf '%s\n' \
  "  actions: read" \
  "  contents: write" \
  "  security-events: write")" "permissions.contents must be read"
run_codeql_workflow_permission_case "missing security events" "$(printf '%s\n' \
  "  actions: read" \
  "  contents: read")" "permissions.security-events must be write"
run_codeql_workflow_permission_case "extra pull requests" "$(printf '%s\n' \
  "  actions: read" \
  "  contents: read" \
  "  security-events: write" \
  "  pull-requests: write")" "permission pull-requests is outside CodeQL least-privilege scope"
run_codeql_workflow_language_case "python" "CodeQL must analyze javascript"
run_codeql_workflow_queries_case "security-extended" "CodeQL queries must include security-extended and security-and-quality"
run_codeql_workflow_category_case "javascript" "CodeQL analyze category must be /language:javascript"
run_codeql_workflow_timeout_case 10
run_codeql_workflow_pinning_case "moving checkout" "v4" "$CODEQL_TEST_ACTION_SHA" "$CODEQL_TEST_ACTION_SHA" "CodeQL workflow actions must be pinned to a full commit SHA"
run_codeql_workflow_pinning_case "uppercase codeql" "$CODEQL_TEST_CHECKOUT_SHA" "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" "$CODEQL_TEST_ACTION_SHA" "SHA must use lowercase hexadecimal characters"
run_dependency_review_workflow_config_pass_case
run_dependency_review_mit_license_case
run_dependency_review_gpl_block_case
run_dependency_review_trigger_failure_case "missing pull_request" "" "pull_request trigger is required"
run_dependency_review_trigger_failure_case "wrong branch" "$(printf '%s\n' \
  "  pull_request:" \
  "    branches:" \
  "      - release")" "pull_request must target main"
run_dependency_review_trigger_failure_case "missing branch filter" "$(printf '%s\n' \
  "  pull_request:")" "pull_request must target main"
run_dependency_review_trigger_failure_case "extra branch" "$(printf '%s\n' \
  "  pull_request:" \
  "    branches:" \
  "      - main" \
  "      - release")" "pull_request must target main"
run_dependency_review_trigger_failure_case "extra push" "$(printf '%s\n' \
  "  pull_request:" \
  "    branches:" \
  "      - main" \
  "  push:")" "Dependency Review workflow must be pull_request-only"
run_dependency_review_trigger_failure_case "extra schedule" "$(printf '%s\n' \
  "  pull_request:" \
  "    branches:" \
  "      - main" \
  "  schedule:" \
  "    - cron: \"0 6 * * 1\"")" "Dependency Review workflow must be pull_request-only"
run_dependency_review_action_pinning_case "moving tag" "v4" "actions/dependency-review-action must be pinned to a full commit SHA"
run_dependency_review_action_pinning_case "moving branch" "main" "actions/dependency-review-action must be pinned to a full commit SHA"
run_dependency_review_action_pinning_boundary_case "123456789012345678901234567890123456789" rejected "39 hexadecimal characters is too short"
run_dependency_review_action_pinning_boundary_case "1234567890123456789012345678901234567890" accepted "40 hexadecimal characters is exactly valid"
run_dependency_review_action_pinning_boundary_case "12345678901234567890123456789012345678901" rejected "41 hexadecimal characters is too long"
run_dependency_review_action_pinning_case "uppercase sha" "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" "full SHA must use lowercase hexadecimal"
run_dependency_review_action_pinning_case "non hex sha" "123456789012345678901234567890123456789g" "full SHA must contain only hexadecimal chars"
run_dependency_review_severity_case "critical" "high severity advisories must fail"
run_dependency_review_missing_severity_input_case
run_dependency_review_wrong_step_severity_case
run_dependency_review_missing_action_step_case
run_dependency_review_license_failure_case "missing MIT allow" "Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0" "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" "missing allowed license MIT"
run_dependency_review_license_failure_case "MIT denied" "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" "${DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES}, MIT" "unexpected denied license MIT"
run_dependency_review_license_failure_case "GPL allowed" "${DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES}, GPL-3.0-only" "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" "unexpected allowed license GPL-3.0-only"
run_dependency_review_license_failure_case "missing GPL deny" "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" "AGPL-1.0-only, AGPL-1.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later, GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-or-later, LGPL-2.0-only, LGPL-2.0-or-later, LGPL-2.1-only, LGPL-2.1-or-later, LGPL-3.0-only, LGPL-3.0-or-later" "missing denied license GPL-3.0-only"
run_dependency_review_allow_whitespace_case "Apache-2.0,MIT,BSD-2-Clause,BSD-3-Clause,ISC,MPL-2.0,CC0-1.0,Unlicense,BlueOak-1.0.0"
run_dependency_review_allow_whitespace_case "Apache-2.0 ,  MIT , BSD-2-Clause , BSD-3-Clause , ISC , MPL-2.0 , CC0-1.0 , Unlicense , BlueOak-1.0.0"
run_dependency_review_deny_whitespace_case "AGPL-1.0-only,AGPL-1.0-or-later,AGPL-3.0-only,AGPL-3.0-or-later,GPL-2.0-only,GPL-2.0-or-later,GPL-3.0-only,GPL-3.0-or-later,LGPL-2.0-only,LGPL-2.0-or-later,LGPL-2.1-only,LGPL-2.1-or-later,LGPL-3.0-only,LGPL-3.0-or-later"
run_dependency_review_deny_whitespace_case "AGPL-1.0-only , AGPL-1.0-or-later , AGPL-3.0-only , AGPL-3.0-or-later , GPL-2.0-only , GPL-2.0-or-later , GPL-3.0-only , GPL-3.0-or-later , LGPL-2.0-only , LGPL-2.0-or-later , LGPL-2.1-only , LGPL-2.1-or-later , LGPL-3.0-only , LGPL-3.0-or-later"
run_dependency_review_license_failure_case "duplicate allow" "Apache-2.0, MIT, MIT, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0" "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" "duplicate allowed license MIT"
run_dependency_review_license_failure_case "reordered allow" "MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0, Unlicense, BlueOak-1.0.0" "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" "allowed licenses must follow the required order"
run_dependency_review_license_failure_case "duplicate deny" "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" "AGPL-1.0-only, AGPL-1.0-only, AGPL-1.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later, GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, LGPL-2.0-only, LGPL-2.0-or-later, LGPL-2.1-only, LGPL-2.1-or-later, LGPL-3.0-only, LGPL-3.0-or-later" "duplicate denied license AGPL-1.0-only"
run_dependency_review_license_failure_case "reordered deny" "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" "GPL-3.0-only, AGPL-1.0-only, AGPL-1.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later, GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-or-later, LGPL-2.0-only, LGPL-2.0-or-later, LGPL-2.1-only, LGPL-2.1-or-later, LGPL-3.0-only, LGPL-3.0-or-later" "denied licenses must follow the required order"
run_dependency_review_license_failure_case "missing allow input" "" "$DEPENDENCY_REVIEW_REQUIRED_DENY_LICENSES" "allow-licenses is required"
run_dependency_review_license_failure_case "missing deny input" "$DEPENDENCY_REVIEW_REQUIRED_ALLOW_LICENSES" "" "deny-licenses is required"
run_dependency_review_combined_license_inputs_case
run_dependency_review_multiline_license_inputs_case
run_dependency_review_duplicate_license_step_case
run_docker_build_action_verification_case
run_docker_build_action_push_true_case
run_docker_build_action_missing_action_case
run_docker_build_action_platform_boundary_case "linux/amd64,linux/arm64" "accepted" "required amd64 and arm64 platforms present"
run_docker_build_action_platform_boundary_case "linux/amd64" "rejected" "arm64 platform is missing"
run_docker_build_action_platform_boundary_case "linux/arm64" "rejected" "amd64 platform is missing"
run_docker_build_action_platform_boundary_case "linux/amd64,linux/arm64,linux/386" "rejected" "extra platform is outside the v0.1 contract"
run_docker_build_action_missing_cache_input_case "cache-from"
run_docker_build_action_missing_cache_input_case "cache-to"
run_docker_build_action_ignores_env_inputs_case
run_docker_build_action_flow_with_mapping_case
run_docker_build_action_build_job_anchor_case
run_docker_build_action_with_block_anchor_case
run_docker_build_action_anchored_flow_with_mapping_case
run_docker_build_action_with_alias_case
run_docker_build_action_with_redefined_alias_case
run_docker_build_action_uses_current_alias_step_occurrence_case
run_docker_build_action_multiline_platforms_case
run_docker_build_action_rejects_folded_platforms_case
run_docker_build_action_ignores_run_block_fake_step_case
run_docker_build_action_ignores_fake_job_markers_case
run_docker_build_action_ignores_nested_build_job_key_case
run_docker_build_action_ignores_nested_steps_key_case
run_docker_build_action_variable_indent_case
run_docker_build_action_indented_root_jobs_case
run_docker_build_action_inline_with_anchor_case
run_docker_build_action_with_comment_before_inputs_case
run_docker_build_action_first_line_with_block_case
run_docker_build_action_rejects_later_push_step_case
run_docker_build_action_ignores_nested_with_scalar_inputs_case
run_docker_build_action_ignores_nested_with_block_case
run_docker_setup_action_pinning_sha_pass_case
run_docker_setup_action_pinning_moving_ref_case "docker/setup-qemu-action@v3"
run_docker_setup_action_pinning_moving_ref_case "docker/setup-buildx-action@v3"
run_docker_setup_action_pinning_moving_ref_case "docker/setup-buildx-action@master"
run_docker_setup_action_pinning_moving_ref_case "docker/setup-qemu-action@3df4ab1"
run_docker_setup_action_pinning_missing_action_case "docker/setup-qemu-action" "docker/setup-buildx-action"
run_docker_setup_action_pinning_missing_action_case "docker/setup-buildx-action" "docker/setup-qemu-action"
run_docker_setup_action_pinning_sha_boundary_case "123456789012345678901234567890123456789" "rejected" "39 hexadecimal characters is too short"
run_docker_setup_action_pinning_sha_boundary_case "1234567890123456789012345678901234567890" "accepted" "40 hexadecimal characters is exactly valid"
run_docker_setup_action_pinning_sha_boundary_case "12345678901234567890123456789012345678901" "rejected" "41 hexadecimal characters is too long"
run_docker_setup_action_pinning_invalid_sha_class_case "123456789012345678901234567890123456789A" "SHA must use lowercase hexadecimal characters"
run_docker_setup_action_pinning_invalid_sha_class_case "123456789012345678901234567890123456789g" "SHA must use lowercase hexadecimal characters"
run_docker_setup_action_pinning_invalid_sha_class_case "123456789012345678901234567890123456789_" "SHA must use lowercase hexadecimal characters"
run_build_docker_needs_required_gates_case
run_build_docker_needs_inline_gates_case
run_build_docker_needs_multiline_flow_gates_case
run_build_docker_needs_scalar_gate_case
run_build_docker_needs_missing_required_gate_case
run_build_docker_needs_missing_needs_case
run_build_docker_needs_anchored_job_case
run_build_docker_scheduler_failed_gate_case
run_build_docker_scheduler_non_success_gate_case
run_release_pipeline_result_case
run_release_pipeline_failed_job_case verify-tag
run_release_pipeline_failed_job_case build-and-push
run_release_pipeline_failed_job_case sbom
run_release_pipeline_failed_job_case gh-release
run_release_pipeline_outline_failure_case verify-tag failure skipped skipped skipped
run_release_pipeline_outline_failure_case build-and-push success failure success skipped
run_release_pipeline_outline_failure_case sbom success success failure skipped
run_release_pipeline_outline_failure_case gh-release success success success failure
run_release_yml_uses_v_star_filter_case
run_release_pipeline_idempotent_case
run_release_trigger_push_tags_case
run_release_trigger_missing_tags_case
run_release_trigger_extra_event_case pull_request
run_release_trigger_extra_event_case workflow_dispatch
run_release_trigger_extra_event_case schedule
run_release_trigger_tag_pattern_boundary_case "v*" accepted "required v prefix is present"
run_release_trigger_extra_tag_pattern_case
run_release_trigger_tag_pattern_boundary_case "*" rejected "non-release tags can trigger"
run_release_trigger_tag_pattern_boundary_case "v0.*" rejected "future v1 tags would not trigger"
run_release_trigger_tag_pattern_boundary_case "release-*" rejected "v prefix contract is missing"
run_release_verify_tag_match_case
run_release_verify_tag_mismatch_case "v0.1.1" "0.1.0" "## [0.1.0]" "tag does not match version"
run_release_verify_tag_mismatch_case "v0.1.0" "0.1.1" "## [0.1.0]" "package version mismatch"
run_release_verify_tag_mismatch_case "v0.1.0" "0.1.0" "## [0.1.1]" "changelog section mismatch"
run_release_verify_missing_changelog_case
run_release_verify_mixed_package_versions_case
run_release_verify_tag_normalization_case "v0.1.0" accepted "tag has one leading v and exact version"
run_release_verify_tag_normalization_case "0.1.0" rejected "tag lacks required v prefix"
run_release_verify_tag_normalization_case "vv0.1.0" rejected "tag has two leading v prefixes"
run_release_verify_tag_format_case "v0.1"
run_release_verify_tag_format_case "v0.1.0-rc.1"
run_release_verify_tag_empty_unreleased_refusal_case
run_release_verify_tag_unreleased_still_populated_case
run_release_verify_tag_unreleased_populated_marker_case "*" "asterisk"
run_release_verify_tag_unreleased_populated_marker_case "+" "plus"
run_release_verify_tag_unreleased_populated_marker_case "1." "numbered-dot"
run_release_verify_tag_unreleased_populated_marker_case "1)" "numbered-paren"
run_release_extract_notes_nominal_case
run_release_extract_notes_release_notes_md_case
run_release_extract_notes_max_bytes_under_cap_case
run_release_extract_notes_max_bytes_over_cap_with_repo_url_case
run_release_extract_notes_max_bytes_over_cap_without_repo_url_case
run_release_extract_notes_max_bytes_rejects_invalid_value_case "0" "zero"
run_release_extract_notes_max_bytes_rejects_invalid_value_case "-5" "negative"
run_release_extract_notes_max_bytes_rejects_invalid_value_case "abc" "non-numeric"
run_release_extract_notes_max_bytes_rejects_invalid_value_case "1.5" "decimal"
run_release_extract_notes_max_bytes_closes_open_fence_case
run_release_extract_notes_max_bytes_fence_does_not_overflow_case
run_release_extract_notes_indented_fence_closure_case
run_release_extract_notes_fence_marker_with_trailing_text_case
run_release_extract_notes_tilde_fence_closure_case
run_release_extract_notes_max_bytes_boundary_case
run_release_extract_notes_rejects_invalid_repo_url_case "ftp://example.com" "non-http-scheme"
run_release_extract_notes_rejects_invalid_repo_url_case "https://example.com/repo)" "trailing-paren"
run_release_extract_notes_rejects_invalid_repo_url_case "https://example.com with space" "embedded-space"
run_release_extract_notes_rejects_invalid_repo_url_case "javascript:alert(1)" "javascript-scheme"
run_readme_references_release_nominal_case
run_readme_references_release_inline_mention_case
run_readme_references_release_fenced_heading_case
run_readme_references_release_tilde_fenced_heading_case
run_readme_references_release_mixed_fence_case
run_readme_references_release_longer_fence_case
run_readme_references_release_closing_fence_info_string_case
run_readme_references_release_crlf_case
run_release_extract_notes_newline_suffix_case
run_readme_references_release_latest_only_case
run_readme_references_release_wrong_repo_case
run_release_commit_and_annotated_tag_case
run_release_verify_tag_annotation_annotated_case
run_release_verify_tag_annotation_lightweight_case
run_release_verify_commit_subject_correct_case
run_release_verify_commit_subject_wrong_case
run_release_tag_version_mismatch_case
run_release_retag_delete_recreate_case
run_release_retag_force_overwrite_case
run_release_extract_notes_malformed_heading_case "## [0.1.0] - 23-05-2026" "dd-mm-yyyy"
run_release_extract_notes_malformed_heading_case "## [0.1.0] - 2026/05/23" "slash-separator"
run_release_extract_notes_malformed_heading_case "## 0.1.0 - 2026-05-23" "missing-brackets"
run_release_extract_notes_malformed_heading_case "## [v0.1.0] - 2026-05-23" "prefixed-v"
run_promote_changelog_nominal_case
run_promote_changelog_empty_unreleased_case
run_promote_changelog_duplicate_version_case
run_promote_changelog_invalid_calendar_date_case "2026-13-40"
run_promote_changelog_invalid_calendar_date_case "2026-02-30"
run_promote_changelog_invalid_calendar_date_case "2026-04-31"
run_promote_changelog_then_verify_tag_case
run_release_build_and_push_case
run_release_build_dynamic_tags_case
run_release_build_push_false_case
run_release_build_platform_boundary_case "linux/amd64,linux/arm64" accepted "required amd64 and arm64 platforms present"
run_release_build_platform_boundary_case "linux/amd64" rejected "arm64 platform is missing"
run_release_build_platform_boundary_case "linux/arm64" rejected "amd64 platform is missing"
run_release_build_platform_boundary_case "linux/amd64,linux/arm64,linux/386" rejected "extra platform is outside the v0.1 contract"
run_release_build_missing_tag_case "v0.2.0"
run_release_build_missing_tag_case "v0.2"
run_release_build_missing_tag_case "v0"
run_release_build_missing_tag_case "latest"
run_release_build_missing_job_case
run_release_build_wrong_repo_case
run_coverage_gate_branch_case "above threshold" 875 1000 0 "packages/llm-providers branches 87.50 >= 85.00"
run_coverage_gate_branch_case "exact threshold" 8500 10000 0 "coverage_gate=pass"
run_coverage_gate_branch_case "below threshold" 8499 10000 1 "packages/llm-providers branches 84.99 < 85.00"
run_coverage_gate_workspace_total_case
run_llm_providers_workflow_threshold_case 85 0 "llm_providers_threshold=pass"
run_llm_providers_workflow_threshold_case 84 1 "llm_providers_threshold=fail"
run_llm_providers_workflow_pnpm_cache_bootstrap_case
run_llm_providers_workflow_typecheck_before_build_case
# R-02 — CI enforces the @sovri/compliance branch coverage gate (>= 90 %).
run_package_coverage_workflow_real_ci_case packages/compliance 90 compliance_threshold
run_package_coverage_workflow_case "compliance gate missing" packages/compliance 90 "" 1 "coverage_gate=missing"
run_package_coverage_workflow_case "compliance gate missing emits fail" packages/compliance 90 "" 1 "compliance_threshold=fail"
run_package_coverage_workflow_case "compliance wired at 90" packages/compliance 90 "90" 0 "compliance_threshold=pass"
run_package_coverage_workflow_case "compliance wired at 89" packages/compliance 90 "89" 1 "packages/compliance threshold 89 < 90"
run_package_coverage_gate_summary_case "compliance branches at 90" packages/compliance 90 9000 10000 0 "coverage_gate=pass"
# R-03 — CI enforces the @sovri/review-engine branch coverage gate (>= 85 %).
run_package_coverage_workflow_real_ci_case packages/review-engine 85 review_engine_threshold
run_package_coverage_workflow_case "review-engine gate missing" packages/review-engine 85 "" 1 "coverage_gate=missing"
run_package_coverage_workflow_case "review-engine gate missing emits fail" packages/review-engine 85 "" 1 "review_engine_threshold=fail"
run_package_coverage_workflow_case "review-engine wired at 85" packages/review-engine 85 "85" 0 "review_engine_threshold=pass"
run_package_coverage_workflow_case "review-engine wired at 84" packages/review-engine 85 "84" 1 "packages/review-engine threshold 84 < 85"
run_package_coverage_gate_summary_case "review-engine branches at 85" packages/review-engine 85 8500 10000 0 "coverage_gate=pass"
run_coverage_artifact_policy_case 90 "always()" 0 "coverage_artifact_retention=pass"
run_coverage_artifact_policy_case 89 "always()" 1 "coverage artifact retention < 90"
run_coverage_artifact_policy_case 90 "success()" 1 "coverage artifact upload must use always()"
run_cosign_deferral_pass_case
run_cosign_missing_note_case
run_cosign_outside_section_case
run_cosign_usage_case "sigstore/cosign-installer@v3"
run_cosign_usage_case "cosign sign ghcr.io/mpiton/sovri/community-bot:v0.2.0"
run_cosign_deferred_version_boundary_case "v0.5" accepted "documented target version"
run_cosign_deferred_version_boundary_case "v1.0" rejected "target version is too late"
run_cosign_deferred_version_boundary_case "a future release" rejected "target version is not concrete"
run_duration_fail_case 300000
run_duration_fail_case 360000
run_duration_queue_exclusion_case
run_duration_cache_miss_case
run_changelog_trigger_pull_request_case
run_changelog_trigger_inline_event_syntax_case
run_changelog_trigger_expression_condition_case
run_changelog_trigger_missing_job_case
run_changelog_trigger_non_pull_request_eligibility_case
run_changelog_trigger_other_workflow_events_case
run_changelog_trigger_pull_request_target_case
run_changelog_diff_ci_only_pass_case
run_changelog_ci_only_failure_assertion_case
run_changelog_diff_workflow_classification_case
run_changelog_diff_failure_message_case
run_changelog_remediation_message_vague_case
run_changelog_diff_with_changelog_has_no_remediation_case
run_changelog_diff_typescript_with_changelog_pass_case
run_changelog_diff_typescript_without_changelog_fails_case
run_changelog_diff_mixed_requires_changelog_case
run_changelog_diff_base_head_non_failure_conditions_pass_case
run_changelog_diff_base_head_typescript_without_changelog_fails_case
run_changelog_diff_typescript_rename_without_changelog_fails_case
run_changelog_diff_typescript_deletion_without_changelog_fails_case
run_changelog_diff_uses_base_head_changed_file_set_case
run_changelog_diff_documentation_only_pass_case
run_changelog_diff_package_markdown_documentation_case
run_changelog_documentation_only_failure_assertion_case
run_changelog_diff_failure_message_example_path_case
run_invalid_cache_state_case
run_action_pinning_sha_pass_case
run_gitleaks_action_pinning_sha_pass_case
run_gitleaks_action_pinning_missing_action_case
run_gitleaks_action_pinning_moving_v2_case
run_gitleaks_action_pinning_sha_boundary_case
run_gitleaks_action_pinning_invalid_sha_class_case
run_gitleaks_action_pinning_non_v2_provenance_case
run_secrets_no_secrets_reuse_direct_call_case
run_secrets_no_secrets_reuse_block_scalar_case
run_secrets_no_secrets_reuse_comment_bypass_case
run_secrets_no_secrets_reuse_inline_patterns_case
run_secrets_no_secrets_reuse_masked_failure_case
run_secrets_no_secrets_reuse_compact_masked_failure_case
run_secrets_no_secrets_reuse_continue_on_error_case
run_secrets_no_secrets_reuse_rethrow_failure_case
run_secrets_no_secrets_reuse_quoted_status_rethrow_case
run_secrets_no_secrets_reuse_continue_on_error_expression_case
run_secrets_no_secrets_reuse_continue_on_error_false_expression_case
run_secrets_no_secrets_reuse_inline_patterns_with_script_case
run_secrets_no_secrets_reuse_missing_script_file_case
run_secrets_no_secrets_reuse_parent_traversal_script_file_case
run_secrets_no_secrets_reuse_absolute_script_file_case
run_secrets_no_secrets_reuse_symlink_script_file_case
run_secrets_no_secrets_reuse_fake_step_in_run_block_case
run_secrets_no_secrets_reuse_folded_scalar_bypass_case
run_secrets_no_secrets_reuse_nested_run_field_case
run_secrets_no_secrets_reuse_run_field_in_block_body_case
run_secrets_no_secrets_reuse_script_path_in_heredoc_body_case
run_secrets_no_secrets_reuse_special_heredoc_delimiter_case
run_secrets_no_secrets_reuse_line_continuation_bypass_case
run_secrets_no_secrets_reuse_folded_scalar_paragraph_case
run_secrets_no_secrets_reuse_shell_option_wrapper_case
run_action_pinning_no_external_refs_case
run_action_pinning_moving_refs_case
run_action_pinning_sha_boundary_case
run_action_pinning_local_action_exempt_case
run_action_pinning_github_maintained_external_case
run_audit_gate_no_high_or_critical_case
run_audit_gate_missing_vulnerability_metadata_case
run_audit_gate_high_vulnerability_case
run_audit_gate_high_without_advisory_name_case
run_audit_gate_mixed_high_and_critical_prioritizes_critical_case
run_audit_gate_critical_vulnerability_case
run_trivy_scan_config_pass_case
run_trivy_scan_config_equivalent_severity_order_case
run_trivy_scan_config_missing_blocking_severity_case "CRITICAL"
run_trivy_scan_config_missing_blocking_severity_case "HIGH"
run_trivy_scan_config_missing_blocking_severity_case "MEDIUM,HIGH"
run_trivy_scan_config_missing_blocking_severity_case "HIGH,CRITICAL,LOW"
run_trivy_scan_config_missing_action_case
run_trivy_scan_config_exit_code_boundary_case "0" "rejected" "zero would not fail CI"
run_trivy_scan_config_exit_code_boundary_case "1" "accepted" "one fails CI on blocking findings"
run_trivy_scan_config_exit_code_boundary_case "2" "rejected" "only exit-code one is in scope"
run_trivy_sarif_upload_config_pass_case
run_trivy_sarif_upload_config_expression_condition_case
run_trivy_sarif_upload_config_upload_before_trivy_case
run_trivy_sarif_upload_config_missing_upload_action_case
run_trivy_sarif_upload_config_different_upload_path_case
run_trivy_sarif_upload_config_boundary_case "sarif" "trivy-results.sarif" "trivy-results.sarif" "always()" "accepted" "producer and uploader use the SARIF path"
run_trivy_sarif_upload_config_boundary_case "table" "trivy-results.sarif" "trivy-results.sarif" "always()" "rejected" "Trivy must emit SARIF"
run_trivy_sarif_upload_config_boundary_case "sarif" "container.sarif" "container.sarif" "always()" "rejected" "Trivy output must be trivy-results.sarif"
run_trivy_sarif_upload_config_boundary_case "sarif" "trivy-results.sarif" "container.sarif" "always()" "rejected" "SARIF upload path must be trivy-results.sarif"
run_trivy_sarif_upload_config_boundary_case "sarif" "trivy-results.sarif" "trivy-results.sarif" "success()" "rejected" "SARIF upload must run after Trivy failure"
run_trivy_vulnerability_gate_no_high_or_critical_case
run_trivy_vulnerability_gate_null_vulnerabilities_case
run_trivy_vulnerability_gate_high_vulnerability_case
run_trivy_vulnerability_gate_critical_vulnerability_case
run_trivy_vulnerability_gate_missing_result_case
run_trivy_step_completion_nonzero_result_case
run_trivy_sarif_upload_after_failure_case
run_secrets_checkout_depth_zero_case
run_secrets_checkout_missing_step_case
run_secrets_checkout_missing_fetch_depth_case
run_secrets_checkout_positive_fetch_depth_case 1
run_secrets_checkout_positive_fetch_depth_case 2
run_secrets_checkout_positive_fetch_depth_case 50
run_secrets_checkout_other_job_full_history_case
run_secrets_checkout_requires_steps_case
run_secrets_checkout_rejects_shallow_checkout_case
run_secrets_checkout_requires_with_fetch_depth_case
run_secrets_checkout_inline_with_mapping_case
run_secrets_checkout_ignores_scalar_job_key_case
run_secrets_checkout_ignores_scalar_step_case
run_false_positive_fixture_resolved_case "benign documentation token shape"
run_false_positive_fixture_resolved_case "intentionally fake token test value"
run_false_positive_fixture_empty_reason_case
run_false_positive_fixture_absent_case
run_false_positive_fixture_unresolved_case
run_false_positive_fixture_real_leak_case

if [ "$FAIL" -ne 0 ]; then
  printf 'ci-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'ci-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
