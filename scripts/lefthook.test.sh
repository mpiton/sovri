#!/usr/bin/env bash
# Test runner for lefthook.yml pre-commit + pre-push wiring (#14).
#
# Asserts the declared shape of lefthook.yml (commands, parallel:true,
# skip rules, fail_text) plus the two functional acceptance criteria from
# issue #14:
#   AC2: a staged file containing `any` would be blocked by the ts-lint hook.
#   AC3: staging a .ts file without CHANGELOG.md updates is blocked by the
#        changelog-updated hook.
#
# AC2 is exercised by running oxlint directly against a temp .ts file,
# because lefthook orchestration is exit-code only and oxlint itself owns
# the failing rule (typescript/no-explicit-any). AC3 replays the inline
# shell snippet from lefthook.yml inside an isolated temp git repo so the
# semantic is asserted independently of lefthook's runner.
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

# oxlint resolves `.oxlintrc.json` `ignorePatterns` relative to the repo
# root and panics when handed a path outside the working tree, so the temp
# `.ts` file must live inside the repo. Use a dot-prefixed name at the root
# to keep it out of source globs and never conflict with a real file.
tmpfile="$REPO_ROOT/.lefthook-test-any.ts"
rm -f "$tmpfile"
trap 'rm -f "$tmpfile"' EXIT

cat >"$tmpfile" <<'EOF'
export function offending(input: any): unknown {
  return input;
}
EOF

# Assert BOTH non-zero exit AND that the failure mentions the responsible
# rule (typescript/no-explicit-any) — otherwise a missing oxlint binary or
# any unrelated lint error would masquerade as AC2 satisfaction.
ac2_out=$(cd "$REPO_ROOT" && pnpm exec oxlint --no-error-on-unmatched-pattern .lefthook-test-any.ts 2>&1)
ac2_ec=$?
if [ "$ac2_ec" -ne 0 ] && printf '%s' "$ac2_out" | grep -q 'no-explicit-any'; then
  record_pass
else
  record_fail "AC2: oxlint must flag 'any' via typescript/no-explicit-any (ec=$ac2_ec, out=$(printf '%s' "$ac2_out" | head -1))"
fi
rm -f "$tmpfile"

# --- 9. AC3: changelog-updated snippet blocks TS-only commits ----------------

scratch=$(mktemp -d 2>/dev/null || mktemp -d -t 'lefthook-changelog') || {
  echo "INFRA: mktemp -d failed" >&2
  exit 2
}
trap 'rm -f "$tmpfile"; rm -rf "$scratch"' EXIT

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
  cd "$scratch"
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  git init -q
  git config user.email test@example.com
  git config user.name Test
  echo "x" >foo.ts
  git add foo.ts
)

case_out=$(cd "$scratch" \
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
  cd "$scratch"
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  echo "# Changelog" >CHANGELOG.md
  git add CHANGELOG.md
)

case_ec=0
(cd "$scratch" \
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
  cd "$scratch"
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  git reset -q
  git add CHANGELOG.md
)

case_ec=0
(cd "$scratch" \
  && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  bash -c "$(declare -f run_changelog_check); run_changelog_check" >/dev/null 2>&1) || case_ec=$?

if [ "$case_ec" -eq 0 ]; then
  record_pass
else
  record_fail "AC3 inverse 2: changelog-updated must pass when only CHANGELOG.md is staged (ec=$case_ec)"
fi

# --- 10. pre-push block is intentionally absent in this PR -------------------

# Scope of #14 is pre-commit only. The pre-push spec from ARCHI.md §16.1
# will land in a follow-up issue. Assert here that the block is not yet
# declared so a partial / accidental pre-push wiring is caught.
if printf '%s\n' "$DUMP" | grep -q '^pre-push:$'; then
  record_fail "pre-push block must NOT be declared yet (deferred to a follow-up; see ARCHI.md §16.1)"
else
  record_pass
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
