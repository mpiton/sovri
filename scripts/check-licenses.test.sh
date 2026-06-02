#!/usr/bin/env bash
# Test runner for scripts/check-licenses.mjs.
# Spawns isolated temp directories with fixture pnpm-licenses JSON files
# and invokes the script via `node --input <fixture>`, asserting exit
# code + stderr substring for each acceptance scenario from issue #12.
# The `--input` escape hatch lets the test bypass `pnpm licenses list`
# itself, so the runner is independent of pnpm and the on-disk
# node_modules — it runs anywhere bash + node are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-licenses.mjs"

# Invocation matches the documented CLI contract (`node
# scripts/check-licenses.mjs ...`), so the runner does not depend on the
# executable bit being set — a file-existence check is enough.
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

# run_case <label> <fixture_fn> <extra_args> <expect_exit> <expect_substring> [extra...]
#   fixture_fn runs inside a fresh temp directory with cwd at its root.
#   It writes any fixture files it needs and prints (to stdout) the
#   args to append after the script name — typically `--input
#   <fixture-path>` or an empty string when the test invokes the script
#   without any input flag.
#   extra_args is forwarded raw as extra positional arguments after the
#   fixture-provided argv (used for the no-arg / explicit-flag tests).
#   expect_substring may be empty to skip stderr substring assertion.
#   Any further arguments are additional substrings that must all be
#   present in stderr.
#
#   stdout and stderr are captured separately so assertions target the
#   stream the script actually writes to. `check-licenses.mjs` never
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
  local tmp script_args stdout stderr stdout_file stderr_file stdout_bytes ec extra

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'check-licenses')
  if [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: mktemp failed"
    return
  fi

  script_args=$(cd "$tmp" && "$fixture_fn") || {
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
  # emptiness assertion below.
  stdout_file="$tmp/.stdout"
  stderr_file="$tmp/.stderr"
  # shellcheck disable=SC2086
  (cd "$tmp" && node "$SCRIPT" $script_args $extra_args >"$stdout_file" 2>"$stderr_file") && ec=0 || ec=$?
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

# Fixture helpers.
#
# Each fixture writes a JSON file in the current temp directory (cwd is
# already there) and echoes the `--input <path>` args the script should
# be invoked with.

# Single-bucket fixture. Args: <license-key> <pkg-name> <version>.
fx_single_allowed_mit() {
  cat > licenses.json <<'JSON'
{
  "MIT": [
    {
      "name": "mit-pkg",
      "versions": ["1.0.0"],
      "paths": ["/store/mit-pkg"],
      "license": "MIT"
    }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_multi_bucket_allowed() {
  cat > licenses.json <<'JSON'
{
  "MIT": [
    { "name": "a", "versions": ["1.0.0"], "paths": ["/store/a"], "license": "MIT" }
  ],
  "Apache-2.0": [
    { "name": "b", "versions": ["2.0.0"], "paths": ["/store/b"], "license": "Apache-2.0" }
  ],
  "ISC": [
    { "name": "c", "versions": ["3.0.0"], "paths": ["/store/c"], "license": "ISC" }
  ],
  "BSD-3-Clause": [
    { "name": "d", "versions": ["4.0.0"], "paths": ["/store/d"], "license": "BSD-3-Clause" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_all_allowed_singletons() {
  cat > licenses.json <<'JSON'
{
  "MIT":           [{"name":"a","versions":["1"],"paths":["/a"],"license":"MIT"}],
  "Apache-2.0":    [{"name":"b","versions":["1"],"paths":["/b"],"license":"Apache-2.0"}],
  "BSD-2-Clause":  [{"name":"c","versions":["1"],"paths":["/c"],"license":"BSD-2-Clause"}],
  "BSD-3-Clause":  [{"name":"d","versions":["1"],"paths":["/d"],"license":"BSD-3-Clause"}],
  "ISC":           [{"name":"e","versions":["1"],"paths":["/e"],"license":"ISC"}],
  "MPL-2.0":       [{"name":"f","versions":["1"],"paths":["/f"],"license":"MPL-2.0"}],
  "CC0-1.0":       [{"name":"g","versions":["1"],"paths":["/g"],"license":"CC0-1.0"}],
  "CC-BY-4.0":     [{"name":"h","versions":["1"],"paths":["/h"],"license":"CC-BY-4.0"}],
  "Python-2.0":    [{"name":"i","versions":["1"],"paths":["/i"],"license":"Python-2.0"}],
  "Unlicense":     [{"name":"j","versions":["1"],"paths":["/j"],"license":"Unlicense"}],
  "BlueOak-1.0.0": [{"name":"k","versions":["1"],"paths":["/k"],"license":"BlueOak-1.0.0"}]
}
JSON
  echo "--input licenses.json"
}

fx_or_dual_allowed() {
  cat > licenses.json <<'JSON'
{
  "(MIT OR Apache-2.0)": [
    { "name": "dual", "versions": ["1.0.0"], "paths": ["/store/dual"], "license": "(MIT OR Apache-2.0)" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_or_picks_allowed_branch() {
  # Compound expression where one branch is denied — OR semantics
  # (SPDX 2.3 §D.5) say the recipient picks any single branch, so as
  # long as one is on the allowlist the package is satisfied.
  cat > licenses.json <<'JSON'
{
  "MIT OR GPL-2.0-only": [
    { "name": "permissive-or-gpl", "versions": ["1.0.0"], "paths": ["/store/permissive-or-gpl"], "license": "MIT OR GPL-2.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_and_all_allowed() {
  cat > licenses.json <<'JSON'
{
  "MIT AND BSD-3-Clause": [
    { "name": "conj", "versions": ["1.0.0"], "paths": ["/store/conj"], "license": "MIT AND BSD-3-Clause" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_with_exception_allowed() {
  cat > licenses.json <<'JSON'
{
  "Apache-2.0 WITH LLVM-exception": [
    { "name": "llvm", "versions": ["1.0.0"], "paths": ["/store/llvm"], "license": "Apache-2.0 WITH LLVM-exception" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_nested_parens_allowed() {
  cat > licenses.json <<'JSON'
{
  "(MIT AND (Apache-2.0 OR BSD-3-Clause))": [
    { "name": "nested", "versions": ["1.0.0"], "paths": ["/store/nested"], "license": "(MIT AND (Apache-2.0 OR BSD-3-Clause))" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_empty_object() {
  printf '{}' > licenses.json
  echo "--input licenses.json"
}

fx_no_licenses_found_text() {
  # pnpm emits a plain text sentinel (not JSON) when --prod yields
  # nothing. The script must accept it as a vacuous pass.
  printf 'No licenses in packages found\n' > licenses.json
  echo "--input licenses.json"
}

fx_empty_file() {
  : > licenses.json
  echo "--input licenses.json"
}

# Denied fixtures.

fx_gpl_3_denied() {
  cat > licenses.json <<'JSON'
{
  "GPL-3.0-only": [
    { "name": "gpl-pkg", "versions": ["1.0.0"], "paths": ["/store/gpl"], "license": "GPL-3.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_agpl_denied() {
  cat > licenses.json <<'JSON'
{
  "AGPL-3.0-or-later": [
    { "name": "agpl-pkg", "versions": ["2.0.0"], "paths": ["/store/agpl"], "license": "AGPL-3.0-or-later" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_lgpl_denied() {
  cat > licenses.json <<'JSON'
{
  "LGPL-2.1-only": [
    { "name": "lgpl-pkg", "versions": ["3.0.0"], "paths": ["/store/lgpl"], "license": "LGPL-2.1-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_legacy_plus_suffix_denied() {
  # SPDX 2.0 used `+` for "or any later version". pnpm passes the
  # licence string through verbatim, so a legacy `LGPL-2.1+` declared in
  # an older package's package.json must still trip the copyleft guard.
  cat > licenses.json <<'JSON'
{
  "LGPL-2.1+": [
    { "name": "legacy-lgpl", "versions": ["1.0.0"], "paths": ["/store/legacy-lgpl"], "license": "LGPL-2.1+" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_and_one_denied_branch() {
  # AND semantics (SPDX 2.3 §D.6): the recipient must satisfy every
  # branch simultaneously, so a single GPL atom is enough to deny.
  cat > licenses.json <<'JSON'
{
  "MIT AND GPL-2.0-only": [
    { "name": "conj-gpl", "versions": ["1.0.0"], "paths": ["/store/conj-gpl"], "license": "MIT AND GPL-2.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_or_no_allowed_branch() {
  cat > licenses.json <<'JSON'
{
  "GPL-2.0-only OR AGPL-3.0-only": [
    { "name": "all-bad", "versions": ["1.0.0"], "paths": ["/store/all-bad"], "license": "GPL-2.0-only OR AGPL-3.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_unknown_denied() {
  cat > licenses.json <<'JSON'
{
  "Unknown": [
    { "name": "unk", "versions": ["1.0.0"], "paths": ["/store/unk"], "license": "Unknown" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_unlicensed_denied() {
  cat > licenses.json <<'JSON'
{
  "UNLICENSED": [
    { "name": "proprietary", "versions": ["1.0.0"], "paths": ["/store/proprietary"], "license": "UNLICENSED" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_see_license_denied() {
  cat > licenses.json <<'JSON'
{
  "SEE LICENSE IN LICENSE.md": [
    { "name": "custom-text", "versions": ["1.0.0"], "paths": ["/store/custom-text"], "license": "SEE LICENSE IN LICENSE.md" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_not_on_allowlist() {
  # Real SPDX identifier, just not on the allowlist (and not GPL family).
  cat > licenses.json <<'JSON'
{
  "OFL-1.1": [
    { "name": "ofl-font", "versions": ["1.0.0"], "paths": ["/store/ofl"], "license": "OFL-1.1" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_blocked_message_metadata() {
  # Used to assert the BLOCKED message exposes name + license + path,
  # i.e. the issue #12 AC "reports offending packages with their
  # license + path".
  cat > licenses.json <<'JSON'
{
  "GPL-2.0-only": [
    { "name": "evil-pkg", "versions": ["1.2.3"], "paths": ["/store/evil-pkg"], "license": "GPL-2.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_mixed_allowed_and_denied() {
  cat > licenses.json <<'JSON'
{
  "MIT": [
    { "name": "good-1", "versions": ["1.0.0"], "paths": ["/store/good-1"], "license": "MIT" },
    { "name": "good-2", "versions": ["2.0.0"], "paths": ["/store/good-2"], "license": "MIT" }
  ],
  "GPL-3.0-or-later": [
    { "name": "bad-1", "versions": ["9.0.0"], "paths": ["/store/bad-1"], "license": "GPL-3.0-or-later" }
  ]
}
JSON
  echo "--input licenses.json"
}

# Error fixtures.

fx_invalid_json() {
  printf 'this is not json' > licenses.json
  echo "--input licenses.json"
}

fx_null_root() {
  printf 'null' > licenses.json
  echo "--input licenses.json"
}

fx_array_root() {
  printf '[]' > licenses.json
  echo "--input licenses.json"
}

fx_bucket_not_array() {
  cat > licenses.json <<'JSON'
{ "MIT": "this should be an array" }
JSON
  echo "--input licenses.json"
}

fx_missing_input_file() {
  # Deliberately do not create the file.
  echo "--input does-not-exist.json"
}

fx_no_input_flag_value() {
  # `--input` with nothing after it — script must reject.
  echo "--input"
}

fx_unknown_flag() {
  echo "--bogus"
}

# Regression fixtures for PR #12 review feedback (F1/F2/F3).

fx_gplv2_no_separator() {
  # `GPLv2` (no hyphen) is a real non-canonical license string used by
  # older npm packages. Must trip the copyleft family regex even though
  # the next char after `GPL` is a word char.
  cat > licenses.json <<'JSON'
{
  "GPLv2": [
    { "name": "legacy-gplv2", "versions": ["1.0.0"], "paths": ["/store/legacy-gplv2"], "license": "GPLv2" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_lgplv3_no_separator() {
  cat > licenses.json <<'JSON'
{
  "LGPLv3": [
    { "name": "legacy-lgplv3", "versions": ["1.0.0"], "paths": ["/store/legacy-lgplv3"], "license": "LGPLv3" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_gpl3_compact() {
  cat > licenses.json <<'JSON'
{
  "GPL3": [
    { "name": "gpl3-compact", "versions": ["1.0.0"], "paths": ["/store/gpl3-compact"], "license": "GPL3" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_bucket_disagrees_with_entry() {
  # Defense in depth: even if pnpm misgroups (entry's `license` field
  # disagrees with the bucket key), per-entry classification must
  # catch a denied license declared on the entry itself.
  cat > licenses.json <<'JSON'
{
  "MIT": [
    { "name": "trojan-gpl", "versions": ["1.0.0"], "paths": ["/store/trojan"], "license": "GPL-3.0-only" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_trailing_or_malformed() {
  # `MIT OR` with no right operand. The OR-short-circuit would silently
  # accept this if the parser did not flag the dangling branch — verify
  # the script denies it as a parse error.
  cat > licenses.json <<'JSON'
{
  "MIT OR": [
    { "name": "trailing-or-pkg", "versions": ["1.0.0"], "paths": ["/store/trailing-or-pkg"], "license": "MIT OR" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_unbalanced_paren() {
  # `(MIT` with no closing paren. Must deny as a parse error.
  cat > licenses.json <<'JSON'
{
  "(MIT": [
    { "name": "unbalanced-pkg", "versions": ["1.0.0"], "paths": ["/store/unbalanced-pkg"], "license": "(MIT" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_with_unknown_exception() {
  # PR #75 Codex P1: an unknown exception token after WITH must be
  # denied as a parse error, not silently treated as the bare licence
  # atom. `MIT WITH totally-made-up` previously passed because the
  # parser stripped any exception identifier without validating it.
  cat > licenses.json <<'JSON'
{
  "MIT WITH totally-made-up": [
    { "name": "sneaky-with", "versions": ["1.0.0"], "paths": ["/store/sneaky-with"], "license": "MIT WITH totally-made-up" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_with_operator_as_exception() {
  # Edge of the same Codex P1: `MIT WITH OR` would tokenise the
  # operator as the exception. Must deny.
  cat > licenses.json <<'JSON'
{
  "MIT WITH OR": [
    { "name": "with-or-pkg", "versions": ["1.0.0"], "paths": ["/store/with-or-pkg"], "license": "MIT WITH OR" }
  ]
}
JSON
  echo "--input licenses.json"
}

fx_with_classpath_allowed() {
  # Classpath-exception-2.0 is a real SPDX-registered exception, so a
  # compound like `Apache-2.0 WITH Classpath-exception-2.0` must still
  # pass.
  cat > licenses.json <<'JSON'
{
  "Apache-2.0 WITH Classpath-exception-2.0": [
    { "name": "classpath-pkg", "versions": ["1.0.0"], "paths": ["/store/classpath-pkg"], "license": "Apache-2.0 WITH Classpath-exception-2.0" }
  ]
}
JSON
  echo "--input licenses.json"
}

# Cases.

# PASS scenarios (exit 0).
run_case "PASS-1  single MIT bucket"                       fx_single_allowed_mit         "" 0 "OK:"
run_case "PASS-2  multiple allowed buckets"                fx_multi_bucket_allowed       "" 0 "OK: 4 package(s)"
run_case "PASS-3  every allowlist licence singleton"       fx_all_allowed_singletons     "" 0 "11 license bucket(s)"
run_case "PASS-4  dual licence (MIT OR Apache-2.0)"        fx_or_dual_allowed            "" 0 "OK:"
run_case "PASS-5  OR picks allowed when other is GPL"      fx_or_picks_allowed_branch    "" 0 "OK:"
run_case "PASS-6  AND with two allowed atoms"              fx_and_all_allowed            "" 0 "OK:"
run_case "PASS-7  WITH exception ignored on allowed atom"  fx_with_exception_allowed     "" 0 "OK:"
run_case "PASS-8  nested parentheses"                      fx_nested_parens_allowed      "" 0 "OK:"
run_case "PASS-9  empty JSON object"                       fx_empty_object               "" 0 "OK: 0 package(s)"
run_case "PASS-10 'No licenses in packages found' text"    fx_no_licenses_found_text     "" 0 "OK: pnpm reported no packages"
run_case "PASS-11 empty file treated as no packages"       fx_empty_file                 "" 0 "OK: pnpm reported no packages"

# FAIL scenarios (exit 1, BLOCKED).
run_case "FAIL-1  GPL-3.0-only denied"                     fx_gpl_3_denied               "" 1 "BLOCKED" \
  "GPL-3.0-only" "gpl-pkg"
run_case "FAIL-2  AGPL-3.0-or-later denied"                fx_agpl_denied                "" 1 "BLOCKED" \
  "AGPL-3.0-or-later"
run_case "FAIL-3  LGPL-2.1-only denied"                    fx_lgpl_denied                "" 1 "BLOCKED" \
  "LGPL-2.1-only"
run_case "FAIL-4  legacy LGPL-2.1+ suffix denied"          fx_legacy_plus_suffix_denied  "" 1 "BLOCKED" \
  "legacy-lgpl" "LGPL-2.1+"
run_case "FAIL-5  AND with one denied branch"              fx_and_one_denied_branch      "" 1 "BLOCKED" \
  "MIT AND GPL-2.0-only" "AND fails on right"
run_case "FAIL-6  OR with no allowed branch"               fx_or_no_allowed_branch       "" 1 "BLOCKED" \
  "GPL-2.0-only OR AGPL-3.0-only"
run_case "FAIL-7  Unknown denied"                          fx_unknown_denied             "" 1 "BLOCKED" \
  "Unknown" "non-SPDX"
run_case "FAIL-8  UNLICENSED denied"                       fx_unlicensed_denied          "" 1 "BLOCKED" \
  "UNLICENSED" "non-SPDX"
run_case "FAIL-9  SEE LICENSE IN ... denied"               fx_see_license_denied         "" 1 "BLOCKED" \
  "SEE LICENSE IN LICENSE.md"
run_case "FAIL-10 valid SPDX but not on allowlist"         fx_not_on_allowlist           "" 1 "BLOCKED" \
  "OFL-1.1" "not on allowlist"
run_case "FAIL-11 BLOCKED reports name, license, path"     fx_blocked_message_metadata   "" 1 "BLOCKED" \
  "evil-pkg@1.2.3" "license: GPL-2.0-only" "path   : /store/evil-pkg"
run_case "FAIL-12 mixed bucket — only denied counted"      fx_mixed_allowed_and_denied   "" 1 "BLOCKED: 1 package(s)" \
  "bad-1@9.0.0"

# ERROR scenarios (exit 2, ERROR).
run_case "ERROR-1 invalid JSON"                            fx_invalid_json               "" 2 "not valid JSON"
run_case "ERROR-2 JSON root is null"                       fx_null_root                  "" 2 "must be a JSON object"
run_case "ERROR-3 JSON root is array"                      fx_array_root                 "" 2 "must be a JSON object"
run_case "ERROR-4 bucket value is not an array"            fx_bucket_not_array           "" 2 'bucket "MIT" is not an array'
run_case "ERROR-5 --input target missing"                  fx_missing_input_file         "" 2 "Cannot read --input file"
run_case "ERROR-6 --input without path"                    fx_no_input_flag_value        "" 2 "--input requires a path"
run_case "ERROR-7 unknown flag rejected"                   fx_unknown_flag               "" 2 'Unknown argument "--bogus"'

# Regression scenarios for PR #12 review feedback.
run_case "FAIL-13 GPLv2 (no separator) denied as copyleft" fx_gplv2_no_separator         "" 1 "BLOCKED" \
  "GPLv2" "copyleft family"
run_case "FAIL-14 LGPLv3 (no separator) denied as copyleft" fx_lgplv3_no_separator       "" 1 "BLOCKED" \
  "LGPLv3" "copyleft family"
run_case "FAIL-15 GPL3 (compact) denied as copyleft"       fx_gpl3_compact               "" 1 "BLOCKED" \
  "GPL3" "copyleft family"
run_case "FAIL-16 bucket says MIT but entry says GPL"      fx_bucket_disagrees_with_entry "" 1 "BLOCKED" \
  "trojan-gpl" "entry license disagrees with bucket" "GPL-3.0-only"
run_case "FAIL-17 trailing OR denied as parse error"       fx_trailing_or_malformed      "" 1 "BLOCKED" \
  "parse error" "unexpected end"
run_case "FAIL-18 unbalanced ( denied as parse error"      fx_unbalanced_paren           "" 1 "BLOCKED" \
  "parse error"
run_case "FAIL-19 WITH unknown exception denied"           fx_with_unknown_exception     "" 1 "BLOCKED" \
  "unknown SPDX exception after WITH" "totally-made-up"
run_case "FAIL-20 WITH OR operator as exception denied"    fx_with_operator_as_exception "" 1 "BLOCKED" \
  "unknown SPDX exception after WITH" "OR"
run_case "PASS-12 WITH Classpath-exception-2.0 allowed"    fx_with_classpath_allowed     "" 0 "OK:"

# Spawn-mode regression tests (no --input flag — exercise the
# `spawnSync("pnpm", ...)` path). Each shadow-pnpms via PATH so we never
# touch the host's real pnpm install.
#
# run_spawn_case <label> <fake_pnpm_script> <expect_exit> <expect_substring> [extra...]
#   `fake_pnpm_script` is the verbatim bash body written to a fake
#   `pnpm` executable on a tmp-dir PATH prefix. The script is invoked
#   exactly as `pnpm licenses list --json` would be — argv preserved.
run_spawn_case() {
  local label="$1"
  local fake_pnpm_body="$2"
  local expect_exit="$3"
  local expect_substring="$4"
  shift 4
  local extra_substrings=("$@")
  local tmp stdout stderr stdout_file stderr_file stdout_bytes ec extra

  tmp=$(mktemp -d 2>/dev/null || mktemp -d -t 'check-licenses-spawn')
  if [ -z "$tmp" ] || [ ! -d "$tmp" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: mktemp failed"
    return
  fi

  printf '%s\n' "$fake_pnpm_body" > "$tmp/pnpm"
  chmod +x "$tmp/pnpm"

  stdout_file="$tmp/.stdout"
  stderr_file="$tmp/.stderr"
  PATH="$tmp:$PATH" node "$SCRIPT" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?
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

# Codex review feedback: a `pnpm` killed by a signal yields
# `status === null` and `signal !== null` from `spawnSync`. The numeric
# `status !== 0` check would not fire, so without explicit signal
# handling the script would fall through to the "no packages to audit"
# vacuous pass and silently bypass the license gate. Shadow a fake
# `pnpm` that self-terminates with SIGTERM after writing no JSON and
# assert the gate refuses to claim success.
run_spawn_case "SPAWN-1 pnpm killed by signal denied with ERROR" \
  '#!/usr/bin/env bash
kill -TERM $$' \
  2 "terminated by signal"

# A pnpm that exits non-zero with a stderr message must surface that
# message and exit 2 — sanity test for the existing numeric-status
# branch alongside the new signal branch above.
run_spawn_case "SPAWN-2 pnpm non-zero exit denied with ERROR" \
  '#!/usr/bin/env bash
echo "boom" >&2
exit 17' \
  2 "exited with code 17" "boom"

TOTAL=$((PASS + FAIL))
echo ""
echo "check-licenses.mjs tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
