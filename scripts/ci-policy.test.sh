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

run_duration_pass_case 180000 "180 s"
run_duration_pass_case 299999 "299.999 s"

if [ "$FAIL" -ne 0 ]; then
  printf 'ci-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'ci-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
