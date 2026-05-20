#!/usr/bin/env bash
# Test runner for scripts/no-forbidden-tools.sh.
# Spawns isolated temporary git repositories and verifies each acceptance
# scenario from issue #9. Independent of pnpm/Vitest so it runs anywhere bash
# and git are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/no-forbidden-tools.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing or not executable" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=""

# run_case <label> <setup_fn> <expect_exit> <expect_substring> [extra_substring...]
#   setup_fn runs inside a fresh temp git repo with cwd at its root and
#   `set -e` enabled, so a failing `git add` aborts visibly. expect_substring
#   may be empty to skip stdout assertion. Any further arguments are
#   additional substrings that must all be present in stdout — used by the
#   "multiple forbidden" case to verify every offending path is listed.
run_case() {
  local label="$1"
  local setup_fn="$2"
  local expect_exit="$3"
  local expect_substring="$4"
  shift 4
  local extra_substrings=("$@")
  local repo setup_log setup_ec out ec extra

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'no-forbidden-tools')
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
    # Tests must run on hosts with `commit.gpgsign=true` globally without a
    # configured signing key — disable signing locally on each temp repo.
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

  out=$(cd "$repo" && "$SCRIPT" 2>&1) && ec=0 || ec=$?

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
  ✗ ${label}: stdout missing substring '${expect_substring}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
    return
  fi

  for extra in "${extra_substrings[@]}"; do
    if ! printf '%s\n' "$out" | grep -Fq -- "$extra"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ ${label}: stdout missing extra substring '${extra}'
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

# Pass scenarios.

setup_empty() { :; }

setup_unrelated_ts() {
  stage_file src/foo.ts 'export const x = 1;'
}

setup_pnpm_lock_only() {
  stage_file pnpm-lock.yaml 'lockfileVersion: 9.0'
}

setup_package_json_only() {
  stage_file package.json '{"name":"demo","version":"0.0.0"}'
}

setup_oxlintrc() {
  stage_file .oxlintrc.json '{}'
}

setup_oxfmtrc() {
  stage_file .oxfmtrc.json '{}'
}

setup_npmrc() {
  # `.npmrc` belongs to no-secrets.sh territory, not no-forbidden-tools.sh —
  # this guard must let it through.
  stage_file .npmrc 'registry=https://registry.npmjs.org/'
}

setup_eslint_in_docs() {
  # A file whose name happens to contain "eslintrc" without the leading dot
  # (no path-component boundary match) must not be flagged.
  stage_file docs/eslintrc-history.md '# notes'
}

setup_prettier_no_dot() {
  # Similarly, `prettier.config.js` (no leading dot) is outside the spec's
  # `.prettier.*` pattern and must not be flagged. If repos start using it,
  # extend the regex in a follow-up.
  stage_file prettier.config.js 'module.exports = {};'
}

setup_eslint_deleted() {
  # Removing an obsolete `.eslintrc.json` must pass — the guard is here to
  # stop additions, not cleanups. --diff-filter=d strips deletions from STAGED.
  stage_file .eslintrc.json '{}'
  git commit -q -m initial
  git rm -q .eslintrc.json
}

# Block scenarios — lockfiles.

setup_npm_lock_root() {
  stage_file package-lock.json '{}'
}

setup_yarn_lock_root() {
  stage_file yarn.lock '# yarn lockfile v1'
}

setup_bun_lock_root() {
  stage_file bun.lockb 'binary'
}

setup_npm_lock_nested() {
  stage_file apps/x/package-lock.json '{}'
}

setup_yarn_lock_nested() {
  stage_file apps/x/yarn.lock '# yarn lockfile v1'
}

setup_bun_lock_nested() {
  stage_file packages/core/bun.lockb 'binary'
}

# Block scenarios — eslint configs.

setup_eslintrc_bare() {
  stage_file .eslintrc 'module.exports = {};'
}

setup_eslintrc_json() {
  stage_file .eslintrc.json '{}'
}

setup_eslintrc_js() {
  stage_file .eslintrc.js 'module.exports = {};'
}

setup_eslintrc_cjs() {
  stage_file .eslintrc.cjs 'module.exports = {};'
}

setup_eslintrc_yaml() {
  stage_file .eslintrc.yaml 'rules: {}'
}

setup_eslintrc_yml() {
  stage_file .eslintrc.yml 'rules: {}'
}

setup_eslintrc_nested() {
  stage_file apps/x/.eslintrc.json '{}'
}

# Block scenarios — biome configs.

setup_biome_json() {
  stage_file biome.json '{}'
}

setup_biome_jsonc() {
  stage_file biome.jsonc '{}'
}

setup_biome_nested() {
  stage_file packages/core/biome.json '{}'
}

# Block scenarios — prettier configs.

setup_prettierrc_bare() {
  stage_file .prettierrc '{}'
}

setup_prettierrc_json() {
  stage_file .prettierrc.json '{}'
}

setup_prettierrc_js() {
  stage_file .prettierrc.js 'module.exports = {};'
}

setup_prettierrc_yaml() {
  stage_file .prettierrc.yaml 'singleQuote: true'
}

setup_prettier_dot_config() {
  stage_file .prettier.config.js 'module.exports = {};'
}

setup_prettier_dot_ignore() {
  stage_file .prettier.ignore 'dist/'
}

setup_prettier_nested() {
  stage_file apps/x/.prettierrc.json '{}'
}

# Block scenarios — multiple forbidden files in one commit.

setup_multiple_forbidden() {
  stage_file package-lock.json '{}'
  stage_file .eslintrc.json '{}'
  stage_file biome.json '{}'
}

setup_any_in_source() {
  stage_file packages/core/src/types.ts 'export const unsafe = (value: any) => value;'
}

setup_ts_ignore_in_source() {
  stage_file packages/core/src/types.ts '// @ts-ignore
export const ignored = missing;'
}

setup_ts_expect_error_in_source() {
  stage_file packages/core/src/types.ts '// @ts-expect-error
export const expected = missing;'
}

setup_oxlint_disable_in_source() {
  stage_file packages/core/src/types.ts '// oxlint-disable-next-line no-console
console.log("debug");'
}

setup_require_in_source() {
  stage_file apps/community-bot/src/server.ts 'const fs = require("node:fs");
export { fs };'
}

setup_module_exports_in_source() {
  stage_file packages/config/src/index.ts 'module.exports = {};
export {};'
}

setup_escape_hatch_in_test_file() {
  stage_file packages/core/src/types.test.ts '// @ts-expect-error test fixture
export const fixture = missing as any;'
}

# Cases.

run_case "PASS-1  empty staged set"             setup_empty               0 ""
run_case "PASS-2  unrelated ts file"            setup_unrelated_ts        0 ""
run_case "PASS-3  pnpm-lock.yaml allowed"       setup_pnpm_lock_only      0 ""
run_case "PASS-4  package.json allowed"         setup_package_json_only   0 ""
run_case "PASS-5  .oxlintrc.json allowed"       setup_oxlintrc            0 ""
run_case "PASS-6  .oxfmtrc.json allowed"        setup_oxfmtrc             0 ""
run_case "PASS-7  .npmrc allowed (other guard)" setup_npmrc               0 ""
run_case "PASS-8  docs/eslintrc-history.md ok"  setup_eslint_in_docs      0 ""
run_case "PASS-9  prettier.config.js (no dot)"  setup_prettier_no_dot     0 ""
run_case "PASS-10 deleting .eslintrc.json ok"   setup_eslint_deleted      0 ""

run_case "BLOCK-1  package-lock.json root"      setup_npm_lock_root       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-2  yarn.lock root"              setup_yarn_lock_root      1 "BLOCKED: forbidden tool files"
run_case "BLOCK-3  bun.lockb root"              setup_bun_lock_root       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-4  package-lock.json nested"    setup_npm_lock_nested     1 "BLOCKED: forbidden tool files"
run_case "BLOCK-5  yarn.lock nested"            setup_yarn_lock_nested    1 "BLOCKED: forbidden tool files"
run_case "BLOCK-6  bun.lockb nested"            setup_bun_lock_nested     1 "BLOCKED: forbidden tool files"

run_case "BLOCK-7  .eslintrc bare"              setup_eslintrc_bare       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-8  .eslintrc.json"              setup_eslintrc_json       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-9  .eslintrc.js"                setup_eslintrc_js         1 "BLOCKED: forbidden tool files"
run_case "BLOCK-10 .eslintrc.cjs"               setup_eslintrc_cjs        1 "BLOCKED: forbidden tool files"
run_case "BLOCK-11 .eslintrc.yaml"              setup_eslintrc_yaml       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-12 .eslintrc.yml"               setup_eslintrc_yml        1 "BLOCKED: forbidden tool files"
run_case "BLOCK-13 .eslintrc.json nested"       setup_eslintrc_nested     1 "BLOCKED: forbidden tool files"

run_case "BLOCK-14 biome.json root"             setup_biome_json          1 "BLOCKED: forbidden tool files"
run_case "BLOCK-15 biome.jsonc root"            setup_biome_jsonc         1 "BLOCKED: forbidden tool files"
run_case "BLOCK-16 biome.json nested"           setup_biome_nested        1 "BLOCKED: forbidden tool files"

run_case "BLOCK-17 .prettierrc bare"            setup_prettierrc_bare     1 "BLOCKED: forbidden tool files"
run_case "BLOCK-18 .prettierrc.json"            setup_prettierrc_json     1 "BLOCKED: forbidden tool files"
run_case "BLOCK-19 .prettierrc.js"              setup_prettierrc_js       1 "BLOCKED: forbidden tool files"
run_case "BLOCK-20 .prettierrc.yaml"            setup_prettierrc_yaml     1 "BLOCKED: forbidden tool files"
run_case "BLOCK-21 .prettier.config.js"         setup_prettier_dot_config 1 "BLOCKED: forbidden tool files"
run_case "BLOCK-22 .prettier.ignore"            setup_prettier_dot_ignore 1 "BLOCKED: forbidden tool files"
run_case "BLOCK-23 .prettierrc.json nested"     setup_prettier_nested     1 "BLOCKED: forbidden tool files"

run_case "BLOCK-24 multiple forbidden at once"  setup_multiple_forbidden  1 "BLOCKED: forbidden tool files" \
  "package-lock.json" ".eslintrc.json" "biome.json"
run_case "BLOCK-25 any in source references ADR-001" setup_any_in_source 1 "ADR-001"
run_case "BLOCK-26 @ts-ignore in source references ADR-001" setup_ts_ignore_in_source 1 "ADR-001"
run_case "BLOCK-27 @ts-expect-error in source references ADR-001" setup_ts_expect_error_in_source 1 "ADR-001"
run_case "BLOCK-28 oxlint-disable in source references ADR-011" setup_oxlint_disable_in_source 1 "ADR-011"
run_case "BLOCK-29 require() in source references ADR-003" setup_require_in_source 1 "ADR-003"
run_case "BLOCK-30 module.exports in source references ADR-003" setup_module_exports_in_source 1 "ADR-003"
run_case "PASS-11 test files may carry fixtures" setup_escape_hatch_in_test_file 0 ""

TOTAL=$((PASS + FAIL))
echo ""
echo "no-forbidden-tools.sh tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
