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

run_duration_pass_case 180000 "180 s"
run_duration_pass_case 299999 "299.999 s"
run_duration_fail_case 300000
run_duration_fail_case 360000
run_duration_queue_exclusion_case
run_duration_cache_miss_case
run_invalid_cache_state_case
run_action_pinning_sha_pass_case
run_action_pinning_no_external_refs_case
run_action_pinning_moving_refs_case
run_action_pinning_sha_boundary_case
run_action_pinning_local_action_exempt_case
run_action_pinning_github_maintained_external_case

if [ "$FAIL" -ne 0 ]; then
  printf 'ci-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'ci-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
