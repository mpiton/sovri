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
