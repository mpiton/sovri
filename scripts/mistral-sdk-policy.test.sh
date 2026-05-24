#!/usr/bin/env bash
# Acceptance tests for the pinned Mistral SDK supply-chain policy.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
FAILURES=""

record_failure() {
  local label="$1"
  local detail="$2"
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  x ${label}: ${detail}"
}

run_audit_passes_high_threshold() {
  local label="pnpm audit passes at the high threshold"

  # Given the workspace lockfile contains "@mistralai/mistralai@2.2.1"
  if ! grep -Fq "@mistralai/mistralai@2.2.1" "$ROOT/pnpm-lock.yaml"; then
    record_failure "$label" "pnpm-lock.yaml does not contain @mistralai/mistralai@2.2.1"
    return
  fi

  # And dependencies are installed with "pnpm install --frozen-lockfile --ignore-scripts"
  # When "pnpm audit --audit-level=high" runs at the workspace root
  # Then the command exits with status 0
  if ! (cd "$ROOT" && pnpm audit --audit-level=high); then
    record_failure "$label" "pnpm audit --audit-level=high failed"
    return
  fi

  # And no high severity advisory is reported
  # And no critical severity advisory is reported
  PASS=$((PASS + 1))
}

run_audit_passes_high_threshold

if [ "$FAIL" -ne 0 ]; then
  printf 'mistral-sdk-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'mistral-sdk-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
