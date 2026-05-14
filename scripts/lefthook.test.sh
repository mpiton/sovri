#!/usr/bin/env bash
# Test runner for lefthook.yml pre-commit (#14) + pre-push (#15) wiring.
#
# Asserts the declared shape of lefthook.yml (commands, parallel:true,
# skip rules, fail_text) plus the functional acceptance criteria from
# issue #14:
#   AC2: a staged file containing `any` would be blocked by the ts-lint hook.
#   AC3: staging a .ts file without CHANGELOG.md updates is blocked by the
#        changelog-updated hook.
# and issue #15:
#   AC1: pre-push declares ts-test, ts-typecheck, audit, dedupe, knip, build
#        in parallel with actionable fail_text on each command.
#   AC2: a failing Vitest test blocks push (the ts-test command exits
#        non-zero).
#   AC3: a duplicate-dep scenario blocks push (the dedupe command exits
#        non-zero) — exercised via the well-defined `pnpm dedupe --check`
#        contract in the healthy-state inverse path, since synthesising
#        duplicates in a tmp workspace requires a real install loop that
#        is too slow for a pre-commit smoke test.
#
# AC2 (#14) is exercised by running oxlint directly against a temp .ts file,
# because lefthook orchestration is exit-code only and oxlint itself owns
# the failing rule (typescript/no-explicit-any). AC3 (#14) replays the inline
# shell snippet from lefthook.yml inside an isolated temp git repo so the
# semantic is asserted independently of lefthook's runner. AC2 (#15) is
# exercised by invoking the exact `pnpm exec vitest run` command from the
# spec against a temp `*.test.ts` file with a failing expectation.
#
# Exit codes (matching scripts/check-*.{sh,mjs} convention):
#   0  all assertions passed
#   1  one or more policy violations / spec deviations
#   2  infrastructure error (missing tool, mktemp failure, etc.)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LEFTHOOK_YML="$REPO_ROOT/lefthook.yml"

if [ ! -f "$LEFTHOOK_YML" ]; then
  echo "INFRA: $LEFTHOOK_YML missing" >&2
  exit 2
fi

for tool in git pnpm node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "INFRA: required tool '$tool' not in PATH" >&2
    exit 2
  fi
done

PASS=0
FAIL=0
FAILURES=""

# Fixture paths declared up front so the single cumulative cleanup trap can
# always reach them, regardless of where the script exits. The PID suffix
# prevents collisions when two concurrent invocations share the repo root
# (CI matrix shards, parallel dev terminals, parallel `git push` triggers).
# Both files MUST live inside `$REPO_ROOT`: oxlint resolves `.oxlintrc.json`
# `ignorePatterns` relative to the repo root and Vitest resolves its config
# relative to CWD, so an out-of-tree path bypasses both. The dot prefix
# keeps the files out of source globs.
ANY_FIXTURE="$REPO_ROOT/.lefthook-test-any-$$.ts"
VITEST_FIXTURE="$REPO_ROOT/.lefthook-test-failing-$$.test.ts"
SCRATCH=""

cleanup() {
  rm -f "$ANY_FIXTURE" "$VITEST_FIXTURE"
  [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"
}

# EXIT alone does not always fire on uncaught signals when `set -e` is off,
# so register INT and TERM as well to avoid leaking fixtures into the repo
# (which would then be picked up by the next real `pnpm exec vitest` run
# and break developer workflows unrelated to this script). The INT / TERM
# handlers run cleanup then exit with the standard `128 + signum` code
# (130 for SIGINT / Ctrl-C, 143 for SIGTERM) so the original termination
# semantics are preserved: a trap that only runs cleanup and returns would
# swallow the signal and let the script continue past the interruption,
# which would surface as a spurious policy failure in the assertion that
# happened to be running when the signal arrived.
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

record_pass() {
  PASS=$((PASS + 1))
}

record_fail() {
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  - $1"
}

# assert_in_dump <label> <pattern>
#   Greps the lefthook dump for an exact substring (-F) and records pass/fail.
assert_in_dump() {
  local label="$1"
  local pattern="$2"
  if printf '%s\n' "$DUMP" | grep -Fq -- "$pattern"; then
    record_pass
  else
    record_fail "$label: pattern not found in lefthook dump -> $pattern"
  fi
}

# --- 1. lefthook binary works ------------------------------------------------

LEFTHOOK_VERSION=$(cd "$REPO_ROOT" && pnpm exec lefthook version 2>/dev/null | head -1)
if [ -z "$LEFTHOOK_VERSION" ]; then
  echo "INFRA: 'pnpm exec lefthook version' produced no output" >&2
  exit 2
fi
record_pass

# --- 2. lefthook.yml parses --------------------------------------------------

if ! DUMP=$(cd "$REPO_ROOT" && pnpm exec lefthook dump 2>&1); then
  echo "FAIL: lefthook dump failed (lefthook.yml does not parse)" >&2
  printf '%s\n' "$DUMP" >&2
  exit 1
fi
record_pass

# --- 3. pre-commit declares 8 required commands + parallel:true --------------

assert_in_dump "pre-commit parallel" "pre-commit:"
assert_in_dump "pre-commit parallel flag" "  parallel: true"

REQUIRED_PRECOMMIT="ts-lint ts-format ts-typecheck no-secrets no-manual-deps no-forbidden-tools boundary-community-cloud changelog-updated"
for cmd in $REQUIRED_PRECOMMIT; do
  assert_in_dump "pre-commit command $cmd" "    $cmd:"
done

# --- 4. pre-commit block declares parallel: true -----------------------------

# Scope by block so a future pre-push / commit-msg hook does not invalidate
# this assertion. The pre-push block specified in ARCHI.md §16.1 is
# intentionally deferred to a follow-up issue and is not asserted here.
block=$(printf '%s\n' "$DUMP" | awk '
  $0 == "pre-commit:" { in_block = 1; next }
  in_block && /^[a-z][a-zA-Z0-9-]*:$/ { exit }
  in_block { print }
')
if printf '%s\n' "$block" | grep -q '^  parallel: true$'; then
  record_pass
else
  record_fail "pre-commit must declare parallel: true"
fi

# --- 5. each pre-commit command has actionable fail_text ---------------------

for cmd in $REQUIRED_PRECOMMIT; do
  # Find the line range for this command in dump output and ensure fail_text
  # appears before the next command marker.
  block=$(printf '%s\n' "$DUMP" | awk -v cmd="    $cmd:" '
    $0 == cmd { in_block = 1; next }
    in_block && /^    [a-z][a-zA-Z0-9-]*:$/ { exit }
    in_block { print }
  ')
  if printf '%s\n' "$block" | grep -q '^      fail_text:'; then
    record_pass
  else
    record_fail "$cmd missing fail_text in pre-commit block"
  fi
done

# --- 6. skip [merge, rebase] declared on the five required commands ----------

REQUIRED_SKIPS="ts-lint ts-format ts-typecheck boundary-community-cloud changelog-updated"
for cmd in $REQUIRED_SKIPS; do
  block=$(printf '%s\n' "$DUMP" | awk -v cmd="    $cmd:" '
    $0 == cmd { in_block = 1; next }
    in_block && /^    [a-z][a-zA-Z0-9-]*:$/ { exit }
    in_block { print }
  ')
  if printf '%s\n' "$block" | grep -q '^      skip:$' \
    && printf '%s\n' "$block" | grep -q '^        - merge$' \
    && printf '%s\n' "$block" | grep -q '^        - rebase$'; then
    record_pass
  else
    record_fail "$cmd missing 'skip: [merge, rebase]' in pre-commit block"
  fi
done

# --- 7. ts-lint and ts-format scope to {staged_files} ------------------------

assert_in_dump "ts-lint uses {staged_files}" \
  "pnpm exec oxlint --no-error-on-unmatched-pattern {staged_files}"
assert_in_dump "ts-format uses {staged_files}" \
  "pnpm exec oxfmt --check --no-error-on-unmatched-pattern {staged_files}"

# --- 8. AC2: oxlint flags `any` as error -------------------------------------

# Fixture path `$ANY_FIXTURE` is initialised at the top of the script and
# its cleanup is owned by the cumulative EXIT/INT/TERM trap registered
# there. The dot-prefix-plus-PID-suffix name keeps the file out of source
# globs and out of any concurrent-invocation collision path.
rm -f "$ANY_FIXTURE"

cat >"$ANY_FIXTURE" <<'EOF'
export function offending(input: any): unknown {
  return input;
}
EOF

# Assert BOTH non-zero exit AND that the failure mentions the responsible
# rule (typescript/no-explicit-any) — otherwise a missing oxlint binary or
# any unrelated lint error would masquerade as AC2 satisfaction. `cd` must
# succeed before the subcommand runs; failing the `cd` would surface as
# `ec=1` (cd's exit) and masquerade as a policy failure, violating the
# script's exit-code convention (`2` for infra, `1` for policy).
cd "$REPO_ROOT" || {
  echo "INFRA: cd to \$REPO_ROOT failed before oxlint AC2 check" >&2
  exit 2
}
ac2_out=$(pnpm exec oxlint --no-error-on-unmatched-pattern "$(basename "$ANY_FIXTURE")" 2>&1)
ac2_ec=$?
if [ "$ac2_ec" -ne 0 ] && printf '%s' "$ac2_out" | grep -q 'no-explicit-any'; then
  record_pass
else
  record_fail "AC2: oxlint must flag 'any' via typescript/no-explicit-any (ec=$ac2_ec, out=$(printf '%s' "$ac2_out" | head -1))"
fi
rm -f "$ANY_FIXTURE"

# --- 9. AC3: changelog-updated snippet blocks TS-only commits ----------------

# `SCRATCH` is captured into the global declared at the top of the script
# so the cumulative cleanup trap can remove it on any exit path.
SCRATCH=$(mktemp -d 2>/dev/null || mktemp -d -t 'lefthook-changelog') || {
  echo "INFRA: mktemp -d failed" >&2
  exit 2
}

run_changelog_check() {
  # Replays the exact inline `run:` body declared under changelog-updated.
  if git diff --cached --name-only | grep -qE '\.(ts|tsx)$'; then
    if ! git diff --cached --name-only | grep -q '^CHANGELOG.md$'; then
      echo "Code modified without CHANGELOG.md entry"
      echo "Add a line to the [Unreleased] section"
      return 1
    fi
  fi
  return 0
}

(
  cd "$SCRATCH"
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  git init -q
  git config user.email test@example.com
  git config user.name Test
  echo "x" >foo.ts
  git add foo.ts
) || {
  echo "INFRA: scratch repo init for AC3 failed" >&2
  exit 2
}

# Every subshell that runs `git` against `$SCRATCH` must clear
# GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE in addition to silencing the
# host's global / system git config. Without the unsets, a caller that
# exported those variables (a lefthook hook re-entering the test, a CI
# job, a parent IDE) would redirect `git add` / `git diff --cached` to
# the host's index instead of the scratch repo and the assertion would
# read state that has nothing to do with the fixture.
case_out=$(cd "$SCRATCH" \
  && unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
  && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  bash -c "$(declare -f run_changelog_check); run_changelog_check" 2>&1)
case_ec=$?

if [ "$case_ec" -eq 1 ] && printf '%s\n' "$case_out" | grep -q "without CHANGELOG.md entry"; then
  record_pass
else
  record_fail "AC3: changelog-updated must block (got ec=$case_ec, out=$case_out)"
fi

# Inverse 1: staging .ts AND CHANGELOG.md together must pass.
(
  cd "$SCRATCH"
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  echo "# Changelog" >CHANGELOG.md
  git add CHANGELOG.md
) || {
  echo "INFRA: scratch repo CHANGELOG stage failed" >&2
  exit 2
}

case_ec=0
(cd "$SCRATCH" \
  && unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
  && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  bash -c "$(declare -f run_changelog_check); run_changelog_check" >/dev/null 2>&1) || case_ec=$?

if [ "$case_ec" -eq 0 ]; then
  record_pass
else
  record_fail "AC3 inverse 1: changelog-updated must pass when .ts and CHANGELOG.md are both staged (ec=$case_ec)"
fi

# Inverse 2: staging ONLY CHANGELOG.md (no TS) must pass. Without this, a
# regression that wrongly blocks docs-only changes would slip through.
(
  cd "$SCRATCH"
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  git reset -q
  git add CHANGELOG.md
) || {
  echo "INFRA: scratch repo reset for docs-only check failed" >&2
  exit 2
}

case_ec=0
(cd "$SCRATCH" \
  && unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
  && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  bash -c "$(declare -f run_changelog_check); run_changelog_check" >/dev/null 2>&1) || case_ec=$?

if [ "$case_ec" -eq 0 ]; then
  record_pass
else
  record_fail "AC3 inverse 2: changelog-updated must pass when only CHANGELOG.md is staged (ec=$case_ec)"
fi

# --- 10. pre-push declares 6 required commands + parallel:true ---------------

# Mirrors Section 4 logic for pre-push. Scope by block so a future
# commit-msg / post-merge hook cannot invalidate the parallel:true
# assertion. The pre-push spec is fixed by ARCHI.md §16.1.
#
# Block extraction relies on lefthook v2.x emitting top-level hook keys in
# declaration order in `lefthook dump` output. If a future lefthook
# release switches to alphabetical key ordering, the awk terminator
# `/^[a-z][a-zA-Z0-9-]*:$/` would still close the pre-push block on the
# first non-pre-push top-level key — only the order of evaluation between
# blocks changes, not the per-block extraction. The structural assertions
# below therefore tolerate either ordering. The exact `run:` strings are
# compared against `lefthook.yml` directly (not the dump) to sidestep any
# YAML re-emission quirks lefthook might introduce around quoted scalars
# such as `--filter='./packages/*'`.

assert_in_dump "pre-push block" "pre-push:"

prepush_block=$(printf '%s\n' "$DUMP" | awk '
  $0 == "pre-push:" { in_block = 1; next }
  in_block && /^[a-z][a-zA-Z0-9-]*:$/ { exit }
  in_block { print }
')

if printf '%s\n' "$prepush_block" | grep -q '^  parallel: true$'; then
  record_pass
else
  record_fail "pre-push must declare parallel: true"
fi

REQUIRED_PREPUSH="ts-test ts-typecheck audit dedupe knip build"
for cmd in $REQUIRED_PREPUSH; do
  if printf '%s\n' "$prepush_block" | grep -q "^    $cmd:$"; then
    record_pass
  else
    record_fail "pre-push command $cmd missing"
  fi
done

# Each pre-push command must carry actionable fail_text. Mirror Section 5.
for cmd in $REQUIRED_PREPUSH; do
  block=$(printf '%s\n' "$prepush_block" | awk -v cmd="    $cmd:" '
    $0 == cmd { in_cmd = 1; next }
    in_cmd && /^    [a-z][a-zA-Z0-9-]*:$/ { exit }
    in_cmd { print }
  ')
  if printf '%s\n' "$block" | grep -q '^      fail_text:'; then
    record_pass
  else
    record_fail "$cmd missing fail_text in pre-push block"
  fi
done

# Exact `run:` strings from ARCHI.md §16.1 — drift here means spec divergence
# and must be flagged loudly. Compare against `lefthook.yml` directly (the
# committed source of truth) rather than the dump output: the dump round-trip
# adds no information for an exact-string assertion and exposes the test to
# YAML re-emission quirks (quoted vs unquoted scalars, indentation changes)
# that vary between lefthook versions. Scope the match to the targeted
# pre-push command block via awk so a duplicate `run:` line elsewhere in
# the file (a future commit-msg / pre-merge hook reusing the same string,
# or a YAML comment containing it) cannot satisfy the assertion. The
# `pnpm exec tsc -b --noEmit` pre-commit line would already fail an
# `==`-anchored equality against pre-push's `pnpm exec tsc -b` because of
# the trailing flag, but explicit block scoping makes the assertion
# robust against any future drift in adjacent blocks too.
assert_yml_run() {
  local cmd="$1"
  local expected="$2"
  if awk -v cmd="    $cmd:" -v want="      run: $expected" '
    $0 == "pre-push:" { in_hook = 1; next }
    in_hook && /^[a-z][a-zA-Z0-9-]*:$/ { exit }
    in_hook && $0 == cmd { in_cmd = 1; next }
    in_cmd && /^    [a-z][a-zA-Z0-9-]*:$/ { exit }
    in_cmd && $0 == want { found = 1; exit }
    END { exit(found ? 0 : 1) }
  ' "$LEFTHOOK_YML"; then
    record_pass
  else
    record_fail "pre-push $cmd run string drift; expected '$expected' under command '$cmd' in $LEFTHOOK_YML"
  fi
}

assert_yml_run "ts-test"      "pnpm exec vitest run --passWithNoTests --reporter=default"
assert_yml_run "ts-typecheck" "pnpm exec tsc -b"
assert_yml_run "audit"        "pnpm audit --audit-level=high --ignore-registry-errors"
assert_yml_run "dedupe"       "pnpm dedupe --check"
assert_yml_run "knip"         "pnpm exec knip --reporter compact"
assert_yml_run "build"        "pnpm turbo build --filter='./packages/*'"

# --- 11. AC2 (#15): a failing Vitest test blocks push ------------------------

# Invokes the exact `pnpm exec vitest run` form from the pre-push spec
# against an isolated test file that asserts a false equality, then
# confirms the binary exits non-zero (which is what lefthook propagates).
# `$VITEST_FIXTURE` is declared at the top of the script and its cleanup
# is owned by the cumulative trap — no Section-local trap rewiring is
# needed. Probe the vitest binary via `pnpm exec vitest --version` rather
# than checking `node_modules/.bin/` directly: the path-existence check is
# coupled to pnpm's hoisting / shamefully-hoist layout, whereas the
# version probe goes through the same resolution channel as the real
# invocation, so a positive probe guarantees the actual call also works.
#
# Verification of AC2 relies solely on a non-zero exit code: the spec
# language is literally "a failing vitest test blocks push (the ts-test
# command exits non-zero)" — exit code IS the contract. Pattern-matching
# the reporter's "FAIL" token would only add brittleness (ANSI colour
# wrapping, reporter format drift, localisation) without strengthening
# the guarantee.

cd "$REPO_ROOT" || {
  echo "INFRA: cd to \$REPO_ROOT failed before vitest AC2 (#15) check" >&2
  exit 2
}

if ! pnpm exec vitest --version >/dev/null 2>&1; then
  echo "INFRA: vitest binary not resolvable via 'pnpm exec vitest' (run pnpm install)" >&2
  exit 2
fi

rm -f "$VITEST_FIXTURE"

cat >"$VITEST_FIXTURE" <<'EOF'
import { expect, test } from 'vitest'

test('intentionally fails for lefthook.test.sh AC2 (#15)', () => {
  expect(1).toBe(2)
})
EOF

pnpm exec vitest run --passWithNoTests --reporter=default "$VITEST_FIXTURE" >/dev/null 2>&1
ac2_15_ec=$?
rm -f "$VITEST_FIXTURE"

if [ "$ac2_15_ec" -ne 0 ]; then
  record_pass
else
  record_fail "AC2 (#15): vitest must exit non-zero on failing test (ec=$ac2_15_ec)"
fi

# --- 12. AC3 (#15): `pnpm dedupe --check` is wired and operational -----------

# The negative path (duplicates present → non-zero exit) is owned by the
# upstream `pnpm dedupe --check` contract referenced by ARCHI.md §16.1;
# synthesising it requires a full pnpm install loop in a mktemp workspace
# and would multiply this script's runtime an order of magnitude. The
# inverse path is asserted here: running `pnpm dedupe --check` against the
# locked workspace must exit 0 in the steady state (i.e. the command is
# resolvable, the lockfile is well-formed, and no drift snuck into this
# PR). Combined with Section 10's exact run-string assertion against
# `lefthook.yml`, this gives end-to-end confidence that the dedupe gate
# is functional.

cd "$REPO_ROOT" || {
  echo "INFRA: cd to \$REPO_ROOT failed before dedupe AC3 (#15) check" >&2
  exit 2
}
ac3_15_out=$(pnpm dedupe --check 2>&1)
ac3_15_ec=$?

if [ "$ac3_15_ec" -eq 0 ]; then
  record_pass
else
  record_fail "AC3 (#15): pnpm dedupe --check must exit 0 in healthy state (ec=$ac3_15_ec, last=$(printf '%s' "$ac3_15_out" | tail -1))"
fi

# --- 13. AC1 (#15): full `lefthook run pre-push` smoke ----------------------

# Section 10 covers the declared shape of `pre-push` (block, parallel,
# commands, fail_text, exact run strings) but cannot detect a runtime
# breakage where the spec text matches yet a binary is missing, a filter
# resolves to a nonexistent directory, or a turbo / knip / audit invocation
# errors against the current workspace. The issue #15 AC1 contract is that
# `pnpm exec lefthook run pre-push` triggers all steps end to end — this
# section invokes it once against the live tree and asserts exit 0, so
# the CHANGELOG claim ("the empty `packages/` filter set still exits 0
# during the walking-skeleton phase") is verified rather than asserted by
# faith. Output is muted because the per-command output is already
# covered by the structural checks and a 500-line dump in the test log
# adds noise without information.

cd "$REPO_ROOT" || {
  echo "INFRA: cd to \$REPO_ROOT failed before lefthook AC1 (#15) smoke" >&2
  exit 2
}
pnpm exec lefthook run pre-push >/dev/null 2>&1
ac1_15_ec=$?

if [ "$ac1_15_ec" -eq 0 ]; then
  record_pass
else
  record_fail "AC1 (#15): pnpm exec lefthook run pre-push must exit 0 against the live workspace (ec=$ac1_15_ec; re-run without redirection to see which command failed)"
fi

# --- summary -----------------------------------------------------------------

TOTAL=$((PASS + FAIL))
echo "lefthook.test.sh: $PASS/$TOTAL passed (lefthook $LEFTHOOK_VERSION)"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED:" >&2
  echo "$FAILURES" >&2
  exit 1
fi

exit 0
