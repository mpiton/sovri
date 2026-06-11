#!/usr/bin/env bash
# Test runner for scripts/check-headers.mjs.
# Spawns isolated temporary git repositories and verifies the per-file license
# header gate (MAT-14). Independent of pnpm/Vitest so it runs anywhere bash,
# git and node are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-headers.mjs"

if [ ! -f "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=""

# run_case <label> <setup_fn> <mode> <expect_exit> <expect_substring> [extra_substring...]
#   setup_fn runs inside a fresh temp git repo with cwd at its root and
#   `set -e` enabled, so a failing `git add` aborts visibly. mode is the flag
#   passed to the script (--staged or --all). expect_substring may be empty to
#   skip the stderr assertion. Further arguments are additional substrings that
#   must all be present in stderr.
run_case() {
  local label="$1"
  local setup_fn="$2"
  local mode="$3"
  local expect_exit="$4"
  local expect_substring="$5"
  shift 5
  local extra_substrings=("$@")
  local repo setup_log setup_ec out ec extra

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'check-headers')
  if [ -z "$repo" ] || [ ! -d "$repo" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: mktemp failed"
    return
  fi

  setup_log="$repo/_setup.log"
  (
    set -e
    cd "$repo"
    unset GIT_TEMPLATE_DIR GIT_DIR GIT_WORK_TREE
    git init -q
    git config user.email test@example.com
    git config user.name test
    git config commit.gpgsign false
    git config tag.gpgsign false
    "$setup_fn"
  ) >"$setup_log" 2>&1
  setup_ec=$?

  if [ "$setup_ec" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: setup failed (ec=${setup_ec})
$(sed 's/^/      /' "$setup_log")"
    rm -rf "$repo"
    return
  fi

  out=$(cd "$repo" && node "$SCRIPT" "$mode" 2>&1) && ec=0 || ec=$?

  rm -rf "$repo"

  if [ "$ec" -ne "$expect_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: expected exit ${expect_exit}, got ${ec}
$(printf '%s\n' "$out" | sed 's/^/      /')"
    return
  fi

  if [ -n "$expect_substring" ] && ! printf '%s\n' "$out" | grep -Fq -- "$expect_substring"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: stderr missing substring '${expect_substring}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
    return
  fi

  for extra in "${extra_substrings[@]}"; do
    if ! printf '%s\n' "$out" | grep -Fq -- "$extra"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ ${label}: stderr missing extra substring '${extra}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
      return
    fi
  done

  PASS=$((PASS + 1))
}

# Shared helpers (must be functions so callers may declare locals).

stage_file() {
  # stage_file <path> [<content>]
  local path="$1"
  local content="${2:-content}"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  git add "$path"
}

# Canonical header blocks, matching the live tree (verified packages/core).
APACHE_HEADER='// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors'
PROPRIETARY_HEADER='// Proprietary — Sovri'

# Pass scenarios.

setup_empty() { :; }

setup_apache_in_core() {
  stage_file packages/core/src/index.ts "$APACHE_HEADER

export const X = 1;"
}

setup_apache_in_bot() {
  stage_file apps/community-bot/src/server.ts "$APACHE_HEADER

export const run = () => 1;"
}

setup_apache_tsx_in_core() {
  stage_file packages/core/src/widget.tsx "$APACHE_HEADER

export const W = 1;"
}

setup_proprietary_in_cloud() {
  stage_file apps/cloud-api/src/index.ts "$PROPRIETARY_HEADER

export const C = 1;"
}

setup_out_of_scope_script() {
  # scripts/ is outside the licensed surface — never scanned even without header.
  stage_file scripts/migrate.ts 'export const x = 1;'
}

setup_out_of_scope_nonts() {
  # A non-.ts file in packages/ is not scanned even without header.
  stage_file packages/core/README.md '# notes'
}

setup_deletion_of_headered_file() {
  # Removing a file must pass — deletions are excluded from the staged set.
  stage_file packages/core/src/legacy.ts "$APACHE_HEADER

export const L = 1;"
  git commit -q -m initial
  git rm -q packages/core/src/legacy.ts
}

setup_copyright_year_2027() {
  # The year is matched by a regex, not pinned to 2026 — a future year passes.
  stage_file packages/core/src/future.ts '// SPDX-License-Identifier: Apache-2.0
// Copyright 2027 Sovri contributors

export const F = 1;'
}

# Block scenarios.

setup_missing_header_in_core() {
  stage_file packages/core/src/bare.ts 'export const X = 1;'
}

setup_missing_copyright_in_core() {
  stage_file packages/core/src/half.ts '// SPDX-License-Identifier: Apache-2.0

export const X = 1;'
}

setup_wrong_copyright_entity() {
  # The canonical copyright holder is "Sovri contributors" (ADR-010). The legacy
  # "Sovri SAS" form is wrong: Sovri is a sole proprietorship, not an SAS.
  stage_file packages/core/src/drift.ts '// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri SAS

export const X = 1;'
}

setup_proprietary_header_in_packages() {
  # A proprietary header in the Apache surface is wrong: packages/ ships Apache.
  stage_file packages/core/src/wrong.ts "$PROPRIETARY_HEADER

export const X = 1;"
}

setup_missing_proprietary_in_cloud() {
  stage_file apps/cloud-api/src/bare.ts 'export const C = 1;'
}

setup_apache_header_in_cloud() {
  # An Apache header inside apps/cloud-api/ is a license leak: proprietary code
  # must never claim Apache 2.0.
  stage_file apps/cloud-api/src/leak.ts "$APACHE_HEADER

export const C = 1;"
}

setup_header_too_deep() {
  # The header must sit at the very top. Buried past the scan window fails.
  stage_file packages/core/src/deep.ts '// line 1
// line 2
// line 3
// line 4
// line 5
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sovri contributors

export const X = 1;'
}

setup_empty_file_in_core() {
  # A zero-byte source file carries no header — fail closed.
  mkdir -p packages/core/src
  : > packages/core/src/placeholder.ts
  git add packages/core/src/placeholder.ts
}

setup_missing_header_in_bot() {
  stage_file apps/community-bot/src/bare.ts 'export const X = 1;'
}

setup_multiple_offenders() {
  stage_file packages/core/src/a.ts 'export const A = 1;'
  stage_file apps/community-bot/src/b.ts 'export const B = 1;'
}

# Cases.

run_case "PASS-1  empty staged set"                    setup_empty                     --staged 0 ""
run_case "PASS-2  apache header in packages/core"       setup_apache_in_core            --staged 0 ""
run_case "PASS-3  apache header in community-bot"       setup_apache_in_bot             --staged 0 ""
run_case "PASS-4  apache header in .tsx"                setup_apache_tsx_in_core        --staged 0 ""
run_case "PASS-5  proprietary header in cloud-api"      setup_proprietary_in_cloud      --staged 0 ""
run_case "PASS-6  scripts/ file outside surface"        setup_out_of_scope_script       --staged 0 ""
run_case "PASS-7  non-.ts file not scanned"             setup_out_of_scope_nonts        --staged 0 ""
run_case "PASS-8  deletion of headered file"            setup_deletion_of_headered_file --staged 0 ""
run_case "PASS-9  copyright year matched by regex"      setup_copyright_year_2027       --staged 0 ""
run_case "PASS-10 apache header via --all mode"         setup_apache_in_core            --all    0 ""

run_case "BLOCK-1  missing header in packages/core"     setup_missing_header_in_core    --staged 1 "BLOCKED" \
  "packages/core/src/bare.ts" "SPDX-License-Identifier: Apache-2.0" "ADR-010"
run_case "BLOCK-2  SPDX present, copyright missing"     setup_missing_copyright_in_core --staged 1 "BLOCKED" \
  "packages/core/src/half.ts" "Copyright"
run_case "BLOCK-3  legacy 'Sovri SAS' entity"           setup_wrong_copyright_entity    --staged 1 "BLOCKED" \
  "packages/core/src/drift.ts"
run_case "BLOCK-4  proprietary header in packages/"     setup_proprietary_header_in_packages --staged 1 "BLOCKED" \
  "packages/core/src/wrong.ts"
run_case "BLOCK-5  missing proprietary in cloud-api"    setup_missing_proprietary_in_cloud --staged 1 "BLOCKED" \
  "apps/cloud-api/src/bare.ts" "Proprietary — Sovri"
run_case "BLOCK-6  apache header in cloud-api (leak)"   setup_apache_header_in_cloud    --staged 1 "BLOCKED" \
  "apps/cloud-api/src/leak.ts" "leak"
run_case "BLOCK-7  header buried past scan window"      setup_header_too_deep           --staged 1 "BLOCKED" \
  "packages/core/src/deep.ts"
run_case "BLOCK-8  empty file fails closed"             setup_empty_file_in_core        --staged 1 "BLOCKED" \
  "packages/core/src/placeholder.ts"
run_case "BLOCK-9  missing header in community-bot"     setup_missing_header_in_bot     --staged 1 "BLOCKED" \
  "apps/community-bot/src/bare.ts"
run_case "BLOCK-10 multiple offenders via --all"        setup_multiple_offenders        --all    1 "BLOCKED" \
  "packages/core/src/a.ts" "apps/community-bot/src/b.ts"

TOTAL=$((PASS + FAIL))
echo ""
echo "check-headers.mjs tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
