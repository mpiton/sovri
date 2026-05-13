#!/usr/bin/env bash
# Test runner for scripts/no-manual-deps.sh.
# Spawns isolated temporary git repositories and verifies each acceptance
# scenario from issue #8. Independent of pnpm/Vitest so it runs anywhere bash,
# git, and node are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/no-manual-deps.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing or not executable" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to run no-manual-deps.sh tests" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=""

# run_case <label> <setup_fn> <expect_exit> <expect_substring>
#   setup_fn runs inside a fresh temp git repo with cwd at its root and
#   `set -e` enabled, so a failing `git add` aborts visibly. expect_substring
#   may be empty to skip stdout assertion.
run_case() {
  local label="$1"
  local setup_fn="$2"
  local expect_exit="$3"
  local expect_substring="$4"
  local repo setup_log setup_ec out ec

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'no-manual-deps')
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

  if [ -n "$expect_substring" ] && ! printf '%s\n' "$out" | grep -q -- "$expect_substring"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: stdout missing substring '${expect_substring}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
    return
  fi

  PASS=$((PASS + 1))
}

# Shared helpers. Each function defines or stages a piece of the temp repo
# state for one scenario. Functions must declare any new variables `local` so
# `set -e` inside the subshell stays meaningful.

write_pkg() {
  # write_pkg <path> <json_body>
  local path="$1"
  local body="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$body" > "$path"
}

commit_initial_pkg() {
  # commit_initial_pkg <path> <json_body>
  # Creates the file at HEAD so subsequent edits compare against a real ref.
  local path="$1"
  local body="$2"
  write_pkg "$path" "$body"
  git add "$path"
  git commit -q -m "initial: $path"
}

# Pass scenarios.

setup_empty() { :; }

setup_unrelated_file() {
  mkdir -p src
  echo 'export const x = 1;' > src/foo.ts
  git add src/foo.ts
}

setup_lockfile_only() {
  # Stage pnpm-lock.yaml without any package.json — outer guard skips.
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add pnpm-lock.yaml
}

setup_scripts_field_change() {
  commit_initial_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "scripts": { "build": "echo old" },
  "dependencies": { "left-pad": "1.3.0" }
}'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "scripts": { "build": "echo new", "test": "echo t" },
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
}

setup_name_field_change() {
  commit_initial_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  write_pkg package.json '{
  "name": "demo-renamed",
  "version": "0.1.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
}

setup_new_pkg_no_deps() {
  # Brand new package.json with no dep blocks at all → empty deps == empty deps.
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "scripts": { "build": "echo ok" }
}'
  git add package.json
}

setup_deps_with_lockfile() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
}

setup_devdeps_with_lockfile() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "devDependencies": { "vitest": "4.0.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
}

setup_peerdeps_with_lockfile() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "peerDependencies": { "react": "19.0.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
}

setup_optionaldeps_with_lockfile() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "optionalDependencies": { "fsevents": "2.3.3" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
}

setup_nested_pkg_with_lockfile() {
  commit_initial_pkg apps/x/package.json '{ "name": "x", "version": "0.0.0" }'
  write_pkg apps/x/package.json '{
  "name": "x",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add apps/x/package.json pnpm-lock.yaml
}

setup_pkg_deleted_with_lockfile() {
  # Initial commit holds both package.json and pnpm-lock.yaml. `pnpm remove`
  # of the last dep deletes the file entirely and updates the lockfile.
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
  git commit -q -m initial
  git rm -q package.json
  echo 'lockfileVersion: 9.0
empty: true' > pnpm-lock.yaml
  git add pnpm-lock.yaml
}

# Block scenarios.

setup_deps_added_no_lock() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
}

setup_devdeps_added_no_lock() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "devDependencies": { "vitest": "4.0.0" }
}'
  git add package.json
}

setup_peerdeps_added_no_lock() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "peerDependencies": { "react": "19.0.0" }
}'
  git add package.json
}

setup_optionaldeps_added_no_lock() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "optionalDependencies": { "fsevents": "2.3.3" }
}'
  git add package.json
}

setup_dep_version_bump_no_lock() {
  commit_initial_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.4.0" }
}'
  git add package.json
}

setup_dep_removed_no_lock() {
  commit_initial_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0", "is-odd": "3.0.1" }
}'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
}

setup_new_pkg_with_deps_no_lock() {
  # Brand new package.json that declares deps without a lockfile.
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
}

setup_nested_deps_no_lock() {
  commit_initial_pkg apps/x/package.json '{ "name": "x", "version": "0.0.0" }'
  write_pkg apps/x/package.json '{
  "name": "x",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add apps/x/package.json
}

setup_npm_lock_alongside() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.1",
  "scripts": { "build": "echo ok" }
}'
  echo '{}' > package-lock.json
  git add package.json package-lock.json
}

setup_yarn_lock_alongside() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.1",
  "scripts": { "build": "echo ok" }
}'
  echo '# yarn lockfile v1' > yarn.lock
  git add package.json yarn.lock
}

setup_bun_lock_alongside() {
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.1",
  "scripts": { "build": "echo ok" }
}'
  printf 'binary' > bun.lockb
  git add package.json bun.lockb
}

setup_pkg_deleted_no_lockfile() {
  # Symmetric to PASS scenario: deletion without lockfile is forbidden — a
  # `pnpm remove` always touches the lockfile.
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
  git commit -q -m initial
  git rm -q package.json
}

setup_deps_added_lockfile_deleted() {
  # Adversarial: stage a dep edit together with `git rm pnpm-lock.yaml`.
  # The file name appears in STAGED but the index entry is gone, so any
  # check that relies on path presence alone would let this through and
  # break `pnpm install --frozen-lockfile` in CI.
  write_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  echo 'lockfileVersion: 9.0' > pnpm-lock.yaml
  git add package.json pnpm-lock.yaml
  git commit -q -m initial
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  git add package.json
  git rm -q pnpm-lock.yaml
}

setup_nested_lockfile_only() {
  # pnpm workspaces use a single root lockfile (ADR-002). A nested
  # `apps/x/pnpm-lock.yaml` staged alongside a root package.json dep change
  # must not satisfy the guard.
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  write_pkg package.json '{
  "name": "demo",
  "version": "0.0.0",
  "dependencies": { "left-pad": "1.3.0" }
}'
  mkdir -p apps/x
  echo 'lockfileVersion: 9.0' > apps/x/pnpm-lock.yaml
  git add package.json apps/x/pnpm-lock.yaml
}

setup_malformed_pkg_json() {
  # Initial commit has clean (empty-deps) package.json. Staged version is
  # syntactically broken JSON: JSON.parse must throw inside the guard so the
  # outer `|| echo "yes"` fallback fires and blocks the commit. Without the
  # fail-closed contract the script would silently let a broken package.json
  # through (both head and index collapse to empty deps under a swallowing
  # catch).
  commit_initial_pkg package.json '{ "name": "demo", "version": "0.0.0" }'
  printf '{ this is not valid json\n' > package.json
  git add package.json
}

# Cases.

run_case "PASS-1  empty staged set"                 setup_empty                       0 ""
run_case "PASS-2  unrelated file only"              setup_unrelated_file              0 ""
run_case "PASS-3  lockfile only (no package.json)"  setup_lockfile_only               0 ""
run_case "PASS-4  scripts field change only"        setup_scripts_field_change        0 ""
run_case "PASS-5  name/version change only"         setup_name_field_change           0 ""
run_case "PASS-6  new package.json no dep blocks"   setup_new_pkg_no_deps             0 ""
run_case "PASS-7  deps + pnpm-lock.yaml staged"     setup_deps_with_lockfile          0 ""
run_case "PASS-8  devDeps + pnpm-lock.yaml staged"  setup_devdeps_with_lockfile       0 ""
run_case "PASS-9  peerDeps + pnpm-lock.yaml staged" setup_peerdeps_with_lockfile      0 ""
run_case "PASS-10 optionalDeps + lockfile staged"   setup_optionaldeps_with_lockfile  0 ""
run_case "PASS-11 nested pkg deps + lockfile"       setup_nested_pkg_with_lockfile    0 ""
run_case "PASS-12 package.json deleted + lockfile"  setup_pkg_deleted_with_lockfile   0 ""

run_case "BLOCK-1  deps added no lockfile"        setup_deps_added_no_lock          1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-2  devDeps added no lockfile"     setup_devdeps_added_no_lock       1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-3  peerDeps added no lockfile"    setup_peerdeps_added_no_lock      1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-4  optionalDeps added no lock"    setup_optionaldeps_added_no_lock  1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-5  dep version bump no lockfile"  setup_dep_version_bump_no_lock    1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-6  dep removed no lockfile"       setup_dep_removed_no_lock         1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-7  new pkg with deps no lock"     setup_new_pkg_with_deps_no_lock   1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-8  nested deps no lockfile"       setup_nested_deps_no_lock         1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-9  package-lock.json staged"      setup_npm_lock_alongside          1 "BLOCKED: package-lock.json, yarn.lock, or bun.lockb"
run_case "BLOCK-10 yarn.lock staged"              setup_yarn_lock_alongside         1 "BLOCKED: package-lock.json, yarn.lock, or bun.lockb"
run_case "BLOCK-11 bun.lockb staged"              setup_bun_lock_alongside          1 "BLOCKED: package-lock.json, yarn.lock, or bun.lockb"
run_case "BLOCK-12 package.json deleted no lock"  setup_pkg_deleted_no_lockfile     1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-13 malformed package.json"        setup_malformed_pkg_json          1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-14 nested lockfile bypass"        setup_nested_lockfile_only        1 "BLOCKED: package.json dependency block changed"
run_case "BLOCK-15 deps + lockfile deleted"       setup_deps_added_lockfile_deleted 1 "BLOCKED: package.json dependency block changed"

TOTAL=$((PASS + FAIL))
echo ""
echo "no-manual-deps.sh tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
