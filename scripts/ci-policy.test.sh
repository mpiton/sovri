#!/usr/bin/env bash
# Acceptance tests for scripts/ci-policy.mjs.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/ci-policy.mjs"

PASS=0
FAIL=0
FAILURES=""

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
run_docker_build_action_verification_case
run_docker_build_action_push_true_case
run_docker_build_action_missing_action_case
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
run_build_docker_needs_required_gates_case
run_build_docker_needs_inline_gates_case
run_build_docker_needs_multiline_flow_gates_case
run_build_docker_needs_scalar_gate_case
run_build_docker_needs_missing_required_gate_case
run_build_docker_needs_missing_needs_case
run_build_docker_scheduler_failed_gate_case
run_build_docker_scheduler_non_success_gate_case
run_duration_fail_case 300000
run_duration_fail_case 360000
run_duration_queue_exclusion_case
run_duration_cache_miss_case
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
