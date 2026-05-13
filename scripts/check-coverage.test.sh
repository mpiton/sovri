#!/usr/bin/env bash
# Test runner for scripts/check-coverage.mjs.
# Spawns isolated temp directories with fixture json-summary files and
# invokes the script via `node`, asserting exit code + stderr substring
# for each acceptance scenario from issue #11. Independent of pnpm /
# Vitest so it runs anywhere bash + node are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-coverage.mjs"

# Invocation matches the documented CLI contract from issue #11
# (`node scripts/check-coverage.mjs ...`), so the runner does not depend
# on the executable bit being set — a file-existence check is enough.
if [ ! -f "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not on PATH" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=""

# run_case <label> <fixture_fn> <args_after_fixture> <expect_exit> <expect_substring> [extra...]
#   fixture_fn runs inside a fresh temp directory with cwd at its root.
#   It writes any fixture json files it needs and prints (to stdout) the
#   path of the coverage-summary file the script should read — or an
#   empty string when the test deliberately points at a missing path.
#   args_after_fixture is a single string with the remaining positional
#   arguments to the script (package-path and threshold), space-separated.
#   expect_substring may be empty to skip stderr assertion. Any further
#   arguments are additional substrings that must all be present in
#   stderr.
#
#   stdout and stderr are captured separately so assertions target the
#   stream the script actually writes to. `check-coverage.mjs` never
#   prints to stdout (success summaries, BLOCKED, and ERROR messages all
#   go to stderr), so the runner also asserts stdout stays empty for
#   every case — a regression that switches any message to stdout would
#   surface immediately.
run_case() {
  local label="$1"
  local fixture_fn="$2"
  local extra_args="$3"
  local expect_exit="$4"
  local expect_substring="$5"
  shift 5
  local extra_substrings=("$@")
  local tmp summary stdout stderr stdout_file stderr_file stdout_bytes ec extra

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'check-coverage')
  if [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: mktemp failed"
    return
  fi

  summary=$(cd "$tmp" && "$fixture_fn") || {
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: fixture setup failed"
    rm -rf "$tmp"
    return
  }

  # Redirect stdout and stderr to distinct files inside the per-case tmp
  # dir so concurrent test runs cannot stomp on each other's streams. We
  # measure stdout in bytes via `wc -c` rather than in a `$(...)` capture
  # because command substitution strips trailing newlines, which would
  # let a regression that prints only `\n` to stdout slip past the
  # emptiness assertion below. An empty $summary is passed through
  # verbatim so missing-file tests can probe the script's usage-error
  # path.
  stdout_file="$tmp/.stdout"
  stderr_file="$tmp/.stderr"
  # shellcheck disable=SC2086
  (cd "$tmp" && node "$SCRIPT" "$summary" $extra_args >"$stdout_file" 2>"$stderr_file") && ec=0 || ec=$?
  stdout_bytes=$(wc -c <"$stdout_file" | tr -d '[:space:]')
  stdout=$(cat "$stdout_file" 2>/dev/null || true)
  stderr=$(cat "$stderr_file" 2>/dev/null || true)

  rm -rf "$tmp"

  if [ "$ec" -ne "$expect_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: expected exit ${expect_exit}, got ${ec}
      stdout:
$(printf '%s\n' "$stdout" | sed 's/^/        /')
      stderr:
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  if [ "${stdout_bytes:-0}" -ne 0 ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: stdout must be empty (got ${stdout_bytes} byte(s)):
$(printf '%s\n' "$stdout" | sed 's/^/        /')"
    return
  fi

  if [ -n "$expect_substring" ] && ! printf '%s\n' "$stderr" | grep -Fq -- "$expect_substring"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: stderr missing substring '${expect_substring}'
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
    return
  fi

  for extra in "${extra_substrings[@]}"; do
    if ! printf '%s\n' "$stderr" | grep -Fq -- "$extra"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ ${label}: stderr missing extra substring '${extra}'
$(printf '%s\n' "$stderr" | sed 's/^/        /')"
      return
    fi
  done

  PASS=$((PASS + 1))
}

# Helpers — emit a json-summary fixture and echo its path.

# Build a single-file entry. Args: metric counts as
# <total> <covered> <skipped> per { lines, statements, functions, branches }.
metric() {
  printf '{"total":%s,"covered":%s,"skipped":%s,"pct":%s}' "$1" "$2" "$3" "$4"
}

# Special case for `pct: "Unknown"` — emitted by Istanbul when total === 0.
metric_unknown() {
  printf '{"total":0,"covered":0,"skipped":0,"pct":"Unknown"}'
}

# Write an entry with all four metric slots. Args:
#   <lines_t> <lines_c> <lines_s> <lines_pct>
#   <branches_t> <branches_c> <branches_s> <branches_pct>
entry_all() {
  local lt="$1" lc="$2" ls="$3" lp="$4" bt="$5" bc="$6" bs="$7" bp="$8"
  printf '{"lines":%s,"statements":%s,"functions":%s,"branches":%s}' \
    "$(metric "$lt" "$lc" "$ls" "$lp")" \
    "$(metric "$lt" "$lc" "$ls" "$lp")" \
    "$(metric 10 10 0 100)" \
    "$(metric "$bt" "$bc" "$bs" "$bp")"
}

# Fixtures.

fx_both_pass_abs() {
  # Both metrics well above threshold.
  cat > coverage-summary.json <<EOF
{
  "total": $(entry_all 100 95 0 95 50 48 0 96),
  "/abs/sovri/packages/core/src/index.ts": $(entry_all 100 95 0 95 50 48 0 96)
}
EOF
  echo "coverage-summary.json"
}

fx_both_pass_relative() {
  # Same as fx_both_pass_abs but with workspace-relative keys.
  cat > coverage-summary.json <<EOF
{
  "total": $(entry_all 100 95 0 95 50 48 0 96),
  "packages/core/src/index.ts": $(entry_all 100 95 0 95 50 48 0 96)
}
EOF
  echo "coverage-summary.json"
}

fx_lines_at_threshold() {
  # lines exactly at 90 %, branches at 91 % — both >= 90 passes.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 90 0 90 100 91 0 91)
}
EOF
  echo "coverage-summary.json"
}

fx_lines_fail() {
  # lines at 85 %, branches at 95 % — fails at threshold 90.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 85 0 85 40 38 0 95)
}
EOF
  echo "coverage-summary.json"
}

fx_branches_fail() {
  # lines at 99 %, branches at 80 % — fails at threshold 85.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 200 198 0 99 20 16 0 80)
}
EOF
  echo "coverage-summary.json"
}

fx_both_fail() {
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 50 0 50 40 20 0 50)
}
EOF
  echo "coverage-summary.json"
}

fx_no_branches_in_package() {
  # Package with zero branchable units (rare — e.g. pure re-export barrel).
  # branches.total == 0 means denom == 0, so pct vacuously == 100.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/barrel.ts": {
    "lines": $(metric 50 50 0 100),
    "statements": $(metric 50 50 0 100),
    "functions": $(metric 5 5 0 100),
    "branches": $(metric 0 0 0 100)
  }
}
EOF
  echo "coverage-summary.json"
}

fx_unknown_pct_per_file() {
  # File-level pct === "Unknown" on branches but lines have data: the
  # script aggregates counts, so the Unknown pct must not crash.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/empty.ts": {
    "lines": $(metric 0 0 0 100),
    "statements": $(metric 0 0 0 100),
    "functions": $(metric 0 0 0 100),
    "branches": $(metric_unknown)
  },
  "/abs/packages/core/src/code.ts": $(entry_all 100 95 0 95 40 38 0 95)
}
EOF
  echo "coverage-summary.json"
}

fx_threshold_zero() {
  # 0 % coverage but threshold 0 must pass (covered/denom = 0/200 = 0 < 0 is false).
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 200 0 0 0 40 0 0 0)
}
EOF
  echo "coverage-summary.json"
}

fx_threshold_hundred_ok() {
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 50 50 0 100 20 20 0 100)
}
EOF
  echo "coverage-summary.json"
}

fx_threshold_hundred_short() {
  # 99 % when threshold = 100 must fail.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 99 0 99 50 50 0 100)
}
EOF
  echo "coverage-summary.json"
}

fx_aggregate_multi_file() {
  # Two files in the same package: 80 % + 100 % aggregate weighted to 90 %.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 80 0 80 50 40 0 80),
  "/abs/packages/core/src/b.ts": $(entry_all 100 100 0 100 50 50 0 100)
}
EOF
  echo "coverage-summary.json"
}

fx_sibling_directory_excluded() {
  # packages/core-extras must NOT count toward packages/core.
  # If the script erroneously matched on substring without trailing slash,
  # 50% from core-extras would aggregate and drop the result below 90.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 95 0 95 40 38 0 95),
  "/abs/packages/core-extras/src/x.ts": $(entry_all 100 50 0 50 40 20 0 50)
}
EOF
  echo "coverage-summary.json"
}

fx_unrelated_only() {
  # No file matches `packages/core/`.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/review-engine/src/x.ts": $(entry_all 100 95 0 95 40 38 0 95)
}
EOF
  echo "coverage-summary.json"
}

fx_all_zero_counts() {
  # Matched entries exist, but every metric has total=0 — vitest scanned
  # nothing usable. Must NOT silently pass.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/empty1.ts": $(entry_all 0 0 0 100 0 0 0 100),
  "/abs/packages/core/src/empty2.ts": $(entry_all 0 0 0 100 0 0 0 100)
}
EOF
  echo "coverage-summary.json"
}

fx_fp_boundary_29_100() {
  # Regression guard for the IEEE 754 boundary bug at threshold 29:
  # `(29/100)*100 === 28.999999999999996`, so a float comparison
  # `pct < 29` would erroneously fail this exactly-at-bound input.
  # Integer comparison `covered * 100 < threshold * denom` lets it pass.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 29 0 29 100 29 0 29)
}
EOF
  echo "coverage-summary.json"
}

fx_only_total() {
  # Summary file with only the "total" sentinel (no per-file entries).
  cat > coverage-summary.json <<EOF
{ "total": $(entry_all 100 95 0 95 40 38 0 95) }
EOF
  echo "coverage-summary.json"
}

fx_invalid_json() {
  printf 'this is not json' > coverage-summary.json
  echo "coverage-summary.json"
}

fx_null_root() {
  printf 'null' > coverage-summary.json
  echo "coverage-summary.json"
}

fx_array_root() {
  printf '[1,2,3]' > coverage-summary.json
  echo "coverage-summary.json"
}

fx_missing_file() {
  # Deliberately do not create the file.
  echo "does-not-exist.json"
}

fx_existing_good() {
  # Used for arg-parsing tests where the file should exist but the test
  # fails earlier on bad threshold / bad package-path / wrong argc.
  cat > coverage-summary.json <<EOF
{
  "/abs/packages/core/src/a.ts": $(entry_all 100 95 0 95 40 38 0 95)
}
EOF
  echo "coverage-summary.json"
}

# Apps (community-bot) variant — same engine, different package path.
fx_bot_pass() {
  cat > coverage-summary.json <<EOF
{
  "/abs/apps/community-bot/src/index.ts": $(entry_all 100 75 0 75 40 30 0 75)
}
EOF
  echo "coverage-summary.json"
}

# Cases.

# PASS scenarios.
run_case "PASS-1  lines + branches well above threshold"   fx_both_pass_abs           "packages/core 90"        0 ""
run_case "PASS-2  workspace-relative json keys"            fx_both_pass_relative      "packages/core 90"        0 ""
run_case "PASS-3  metrics exactly at threshold"            fx_lines_at_threshold      "packages/core 90"        0 ""
run_case "PASS-4  package without branchable units"        fx_no_branches_in_package  "packages/core 90"        0 ""
run_case "PASS-5  per-file pct == Unknown ignored"         fx_unknown_pct_per_file    "packages/core 90"        0 ""
run_case "PASS-6  threshold 0 with 0 % coverage"           fx_threshold_zero          "packages/core 0"         0 ""
run_case "PASS-7  threshold 100 with full coverage"        fx_threshold_hundred_ok    "packages/core 100"       0 ""
run_case "PASS-8  multi-file aggregation reaches 90 %"     fx_aggregate_multi_file    "packages/core 90"        0 ""
run_case "PASS-9  sibling dir core-extras excluded"        fx_sibling_directory_excluded "packages/core 90"     0 ""
run_case "PASS-10 apps/community-bot path"                 fx_bot_pass                "apps/community-bot 70"   0 ""
run_case "PASS-11 IEEE 754 boundary 29/100 at T=29"        fx_fp_boundary_29_100      "packages/core 29"        0 "OK: packages/core"
run_case "PASS-12 success line prints on stderr"           fx_both_pass_abs           "packages/core 90"        0 "OK: packages/core"

# FAIL scenarios (exit 1, BLOCKED).
run_case "FAIL-1  lines below threshold"                   fx_lines_fail              "packages/core 90"        1 "BLOCKED" \
  "lines" "packages/core" ">= 90 %"
run_case "FAIL-2  branches below threshold"                fx_branches_fail           "packages/core 85"        1 "BLOCKED" \
  "branches" "packages/core" ">= 85 %"
run_case "FAIL-3  both metrics below threshold"            fx_both_fail               "packages/core 70"        1 "BLOCKED" \
  "lines" "branches"
run_case "FAIL-4  threshold 100 not reached by 99 %"       fx_threshold_hundred_short "packages/core 100"       1 "BLOCKED" \
  "lines"

# ERROR scenarios (exit 2, ERROR).
run_case "ERROR-1  no package-path arg (argc == 1)"        fx_existing_good           ""                        2 "Expected 3 arguments"
run_case "ERROR-2  missing threshold arg (argc == 2)"      fx_existing_good           "packages/core"           2 "Expected 3 arguments"
run_case "ERROR-3  extra arg (argc == 4)"                  fx_existing_good           "packages/core 90 oops"   2 "Expected 3 arguments"
run_case "ERROR-4  non-numeric threshold"                  fx_existing_good           "packages/core abc"       2 "<threshold> must be an integer"
run_case "ERROR-5  decimal threshold rejected"             fx_existing_good           "packages/core 90.5"      2 "<threshold> must be an integer"
run_case "ERROR-6  negative threshold rejected"            fx_existing_good           "packages/core -5"        2 "<threshold> must be an integer"
run_case "ERROR-7  threshold > 100 rejected"               fx_existing_good           "packages/core 101"       2 "<threshold> must be an integer"
run_case "ERROR-8  absolute package-path rejected"         fx_existing_good           "/packages/core 90"       2 "<package-path>"
run_case "ERROR-9  package-path with .. rejected"          fx_existing_good           "packages/../etc 90"      2 "<package-path>"
run_case "ERROR-10 missing summary file"                   fx_missing_file            "packages/core 90"        2 "Cannot read coverage summary"
run_case "ERROR-11 invalid JSON"                           fx_invalid_json            "packages/core 90"        2 "not valid JSON"
run_case "ERROR-12 JSON root is null"                      fx_null_root               "packages/core 90"        2 "must be a JSON object"
run_case "ERROR-13 JSON root is array"                     fx_array_root              "packages/core 90"        2 "must be a JSON object"
run_case "ERROR-14 no entries for package path"            fx_unrelated_only          "packages/core 90"        2 "No coverage entries match package"
run_case "ERROR-15 only \"total\" key, no per-file"        fx_only_total              "packages/core 90"        2 "No coverage entries match package"
run_case "ERROR-16 all-zero counts across matched files"   fx_all_zero_counts         "packages/core 90"        2 "zero countable units"

TOTAL=$((PASS + FAIL))
echo ""
echo "check-coverage.mjs tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
