#!/usr/bin/env bash
# Test runner for scripts/check-boundary.sh.
# Spawns isolated temporary git repositories and verifies each acceptance
# scenario from issue #10. Independent of pnpm/Vitest so it runs anywhere bash
# and git are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/check-boundary.sh"

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
#   "multiple breaches" case to verify every offending path is listed.
run_case() {
  local label="$1"
  local setup_fn="$2"
  local expect_exit="$3"
  local expect_substring="$4"
  shift 4
  local extra_substrings=("$@")
  local repo setup_log setup_ec out ec extra

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'check-boundary')
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

setup_unrelated_ts_in_core() {
  stage_file packages/core/src/index.ts 'import { z } from "zod";
export const X = z.string();'
}

setup_unrelated_ts_in_bot() {
  stage_file apps/community-bot/src/index.ts 'import { Probot } from "probot";
export default (app: Probot) => app;'
}

setup_local_cloud_api_name_in_core() {
  # A local file named with `cloud-api` in it, imported via `./` sibling path,
  # must NOT match — only `../` relative climbs are recognised as breaches.
  stage_file packages/core/src/cloud-api-mock.ts 'export const fake = 1;'
  stage_file packages/core/src/uses.ts 'import { fake } from "./cloud-api-mock";'
}

setup_other_at_scope_in_core() {
  stage_file packages/core/src/index.ts 'import { X } from "@sovri/core";'
}

setup_clouded_package_in_core() {
  stage_file packages/core/src/index.ts 'import { x } from "@sovri/clouded";'
}

setup_md_in_core() {
  # Non-TS file is not scanned even if it mentions @sovri/cloud-api literally.
  stage_file packages/core/notes.md 'see @sovri/cloud-api one day'
}

setup_cloud_api_file_itself() {
  # apps/cloud-api/ is outside the public surface so it may freely import
  # anything (the path filter excludes it from STAGED).
  stage_file apps/cloud-api/src/x.ts 'import { X } from "@sovri/cloud-internals";'
}

setup_apps_other_outside_bot() {
  # An app that is NOT community-bot is also outside the public surface.
  stage_file apps/some-future-thing/src/x.ts 'import { X } from "@sovri/cloud-anything";'
}

setup_root_file_with_cloud_text() {
  # Top-level scripts/ file outside both surfaces — never scanned.
  stage_file scripts/migrate.ts 'import { X } from "@sovri/cloud";'
}

setup_deletion_of_cloud_importer() {
  # Removing a stale cloud importer must pass — the guard is here to stop
  # additions, not cleanups. --diff-filter=d strips deletions from STAGED.
  stage_file packages/core/src/legacy.ts 'import { X } from "@sovri/cloud";'
  git commit -q -m initial
  git rm -q packages/core/src/legacy.ts
}

setup_string_literal_mentions_cloud_api() {
  # A fixture or constant whose string body embeds the forbidden specifier
  # must NOT be flagged. The pattern is anchored to a real statement
  # boundary, so anything starting with `const`/`let`/`var` (or any line
  # that does not begin with `import`/`export`/`from` after whitespace) is
  # safe.
  stage_file packages/core/src/fixture.ts 'export const FIXTURE = "see import { X } from \"../../legacy/cloud-api/x\" for the old layout";'
}

setup_comment_mentions_cloud_api() {
  # Inline `//` and block comments that describe the forbidden pattern must
  # NOT be flagged. The leading `//` or `*` defeats the import anchor.
  stage_file packages/core/src/notes.ts '// historical note: we used to import { X } from "@sovri/cloud-api"
// before the boundary was enforced.
export const ok = 1;'
}

setup_similar_identifier_call() {
  # `coreImport(...)` and `myRequire(...)` must NOT trip the dynamic-import
  # branch — the regex demands a non-identifier boundary before the
  # `import` / `require` keyword.
  stage_file packages/core/src/utils.ts 'export const coreImport = (x: string) => x;
const r = coreImport("@sovri/cloud-api");
export { r };'
}

setup_empty_ts_file() {
  # A genuinely empty (zero-byte) `.ts` file must pass. `stage_file`
  # cannot produce a zero-byte file because `printf '%s\n'` always
  # writes at least one newline, so the fixture is created directly
  # here via shell-redirection truncation.
  mkdir -p packages/core/src
  : > packages/core/src/placeholder.ts
  git add packages/core/src/placeholder.ts
}

setup_parent_sibling_cloud_api_name() {
  # PR #73 review: `../cloud-api-mock` is a parent-sibling import that
  # does NOT cross into `apps/cloud-api/` and must pass. The relative
  # alternative now requires a path-component boundary (`/` or quote)
  # after `cloud-api`, so the `-mock` suffix breaks the match.
  stage_file packages/core/src/uses_parent_mock.ts 'import { fake } from "../cloud-api-mock";'
}

setup_segment_suffix_cloud_api() {
  # PR #73 review (Codex P2): `../mock-cloud-api/x` embeds `cloud-api`
  # as a suffix of a path segment, not as a segment of its own. The
  # `(.*/)?` anchor before `cloud-api` requires every preceding
  # character on this side of the `../` to end with `/`, so the `mock-`
  # prefix breaks the match.
  stage_file packages/core/src/uses_segment_suffix.ts 'import { x } from "../mock-cloud-api/x";'
}

setup_dynamic_tokens_in_comment_and_string() {
  # Regression guard for the PR #73 review feedback (CodeRabbit, Codex,
  # cubic-dev-ai): `import("...")` and `require("...")` shown as text
  # inside comments or string literals must NOT be flagged. Covers
  # whole-line `//`, trailing `//`, inline `/* ... */`, JSDoc body
  # continuation (` *`), and escaped string literal contexts.
  stage_file packages/core/src/notes.ts '// historical: import("@sovri/cloud-api") used to be here
/** require("@sovri/cloud-api") shown in jsdoc */
 * import("@sovri/cloud-api") body continuation
const code = 1; // import("@sovri/cloud-api") trailing
export const STR = "import(\"@sovri/cloud-api\")";
export const ok = 1;'
}

# Block scenarios — @sovri/cloud scope.

setup_at_sovri_cloud_in_core_at_line_3() {
  # Three-line file so the offending statement is at line 3 — used to
  # assert that the guard reports `3:` in the line-prefixed grep output
  # (regression guard against losing `-n` on grep).
  stage_file packages/core/src/breach.ts '// header comment
// continued
import { X } from "@sovri/cloud-api";'
}

setup_import_type_from_cloud() {
  # `import type` is still a build-time dependency on the proprietary
  # surface — must be blocked even though the runtime emit is erased.
  stage_file packages/core/src/breach.ts 'import type { X } from "@sovri/cloud-api";'
}

setup_export_type_from_cloud() {
  # Type-only re-export from cloud — same blocking rationale as
  # `import type`.
  stage_file packages/core/src/breach.ts 'export type { X } from "@sovri/cloud-api";'
}

setup_multiline_from_continuation() {
  # Multi-line destructured import where `from` sits on its own line. The
  # per-line scan must still detect this via the bare-`from` alternative.
  stage_file packages/core/src/breach.ts 'import {
  CloudClient,
  CloudConfig,
}
from "@sovri/cloud-api";'
}

setup_side_effect_import() {
  # Bare side-effect import (no `from`, no specifier binding) — common for
  # registration / polyfill modules.
  stage_file packages/core/src/breach.ts 'import "@sovri/cloud-api/register";'
}

setup_dynamic_import_call() {
  # ESM dynamic import. Pre-commit catches the on-one-line form.
  stage_file packages/core/src/breach.ts 'export async function load() {
  return import("@sovri/cloud-api");
}'
}

setup_require_call() {
  # ADR-003 forbids CommonJS, but a stray `require` in a .ts file (e.g.
  # via `createRequire`) should still be caught by the boundary guard.
  stage_file packages/core/src/breach.ts 'export const m = require("@sovri/cloud-api");'
}

# Block scenarios — @sovri/cloud scope.

setup_at_sovri_cloud_in_core() {
  stage_file packages/core/src/breach.ts 'import { X } from "@sovri/cloud";'
}

setup_at_sovri_cloud_internals() {
  stage_file packages/core/src/breach.ts 'import { X } from "@sovri/cloud-internals";'
}

setup_at_sovri_cloud_api_named() {
  stage_file packages/core/src/breach.ts 'import { X } from "@sovri/cloud-api";'
}

setup_at_sovri_cloud_single_quote() {
  stage_file packages/core/src/breach.ts "import { X } from '@sovri/cloud-foo';"
}

setup_at_sovri_cloud_in_bot() {
  stage_file apps/community-bot/src/breach.ts 'import { X } from "@sovri/cloud-something";'
}

setup_at_sovri_cloud_in_review_engine() {
  stage_file packages/review-engine/src/breach.ts 'import { X } from "@sovri/cloud-api";'
}

setup_at_sovri_cloud_tsx() {
  stage_file packages/core/src/breach.tsx 'import { X } from "@sovri/cloud-api";'
}

setup_export_from_cloud() {
  # `export * from "..."` is also `from "..."` — must be caught.
  stage_file packages/core/src/breach.ts 'export * from "@sovri/cloud-api";'
}

# Block scenarios — relative `../...cloud-api` paths.

setup_relative_climb_in_core() {
  stage_file packages/core/src/breach.ts 'import { X } from "../../apps/cloud-api/x";'
}

setup_relative_climb_short_in_bot() {
  stage_file apps/community-bot/src/breach.ts 'import { X } from "../cloud-api/y";'
}

setup_relative_climb_deep() {
  stage_file packages/review-engine/src/sub/breach.ts 'import { X } from "../../../apps/cloud-api/x";'
}

# Block scenarios — multiple offenders in one commit.

setup_multiple_breaches() {
  stage_file packages/core/src/a.ts 'import { X } from "@sovri/cloud-api";'
  stage_file apps/community-bot/src/b.ts 'import { Y } from "../../apps/cloud-api/y";'
}

setup_concat_dynamic_import() {
  # PR #73 review (cubic-dev-ai): `+` is a real expression-context
  # boundary; `"prefix" + import("@sovri/cloud-api")` must block.
  stage_file packages/core/src/breach.ts 'export const X = "foo" + import("@sovri/cloud-api");'
}

setup_unary_minus_dynamic_import() {
  # `-import("...")` is exotic but legal — keep `-` in the boundary
  # whitelist alongside `+` for symmetry.
  stage_file packages/core/src/breach.ts 'export const X = -import("@sovri/cloud-api");'
}

setup_conditional_dynamic_import() {
  # PR #73 review (Codex P1): `if (ok) import("...")` puts `)` directly
  # before the keyword. The dynamic punctuation whitelist must include
  # `)` for the boundary to fire.
  stage_file packages/core/src/breach.ts 'const ok = true;
if (ok) import("@sovri/cloud-api");'
}

setup_backtick_dynamic_named() {
  # PR #73 review (Codex P1): a template-literal specifier on a real
  # dynamic import must block. The quote class on the dynamic
  # alternative must accept backtick alongside `'` and `"`.
  stage_file packages/core/src/breach.ts 'const x = import(`@sovri/cloud-api`);'
}

setup_backtick_dynamic_relative() {
  # Same case with a relative climb specifier inside the backticks.
  stage_file packages/core/src/breach.ts 'const x = import(`../../apps/cloud-api/y`);'
}

# Cases.

run_case "PASS-1  empty staged set"                       setup_empty                            0 ""
run_case "PASS-2  unrelated ts in packages/core"          setup_unrelated_ts_in_core             0 ""
run_case "PASS-3  unrelated ts in apps/community-bot"     setup_unrelated_ts_in_bot              0 ""
run_case "PASS-4  ./cloud-api-mock sibling import ok"     setup_local_cloud_api_name_in_core     0 ""
run_case "PASS-5  @sovri/core scope ok"                   setup_other_at_scope_in_core           0 ""
run_case "PASS-5b @sovri/clouded package ok"              setup_clouded_package_in_core          0 ""
run_case "PASS-6  .md mentioning @sovri/cloud-api ok"     setup_md_in_core                       0 ""
run_case "PASS-7  apps/cloud-api/ itself unrestricted"    setup_cloud_api_file_itself            0 ""
run_case "PASS-8  apps/<other>/ outside boundary"         setup_apps_other_outside_bot           0 ""
run_case "PASS-9  scripts/ file outside boundary"         setup_root_file_with_cloud_text        0 ""
run_case "PASS-10 deleting stale cloud importer ok"       setup_deletion_of_cloud_importer       0 ""
run_case "PASS-11 string literal mentions cloud-api"      setup_string_literal_mentions_cloud_api 0 ""
run_case "PASS-12 comment mentions @sovri/cloud-api"      setup_comment_mentions_cloud_api       0 ""
run_case "PASS-13 coreImport()/myRequire() identifiers"   setup_similar_identifier_call          0 ""
run_case "PASS-14 empty .ts file ok"                      setup_empty_ts_file                    0 ""
run_case "PASS-15 dynamic tokens in comment/string"       setup_dynamic_tokens_in_comment_and_string 0 ""
run_case "PASS-16 ../cloud-api-mock parent sibling"       setup_parent_sibling_cloud_api_name    0 ""
run_case "PASS-17 ../mock-cloud-api/x segment suffix"     setup_segment_suffix_cloud_api         0 ""

run_case "BLOCK-1  packages/core @sovri/cloud"            setup_at_sovri_cloud_in_core           1 "BLOCKED: Cloud import"
run_case "BLOCK-2  @sovri/cloud-internals"                setup_at_sovri_cloud_internals         1 "BLOCKED: Cloud import"
run_case "BLOCK-3  @sovri/cloud-api scope"                setup_at_sovri_cloud_api_named         1 "BLOCKED: Cloud import"
run_case "BLOCK-4  single-quoted @sovri/cloud-foo"        setup_at_sovri_cloud_single_quote      1 "BLOCKED: Cloud import"
run_case "BLOCK-5  apps/community-bot @sovri/cloud-..."   setup_at_sovri_cloud_in_bot            1 "BLOCKED: Cloud import"
run_case "BLOCK-6  packages/review-engine @sovri/cloud"   setup_at_sovri_cloud_in_review_engine  1 "BLOCKED: Cloud import"
run_case "BLOCK-7  .tsx file with @sovri/cloud-api"       setup_at_sovri_cloud_tsx               1 "BLOCKED: Cloud import"
run_case "BLOCK-8  export * from @sovri/cloud-api"        setup_export_from_cloud                1 "BLOCKED: Cloud import"

run_case "BLOCK-9  ../../apps/cloud-api from core"        setup_relative_climb_in_core           1 "BLOCKED: Cloud import"
run_case "BLOCK-10 ../cloud-api from community-bot"       setup_relative_climb_short_in_bot      1 "BLOCKED: Cloud import"
run_case "BLOCK-11 ../../../apps/cloud-api deep"          setup_relative_climb_deep              1 "BLOCKED: Cloud import"

run_case "BLOCK-12 multiple breaches in one commit"       setup_multiple_breaches                1 "BLOCKED: Cloud import" \
  "packages/core/src/a.ts" "apps/community-bot/src/b.ts" "ADR-010"
run_case "BLOCK-20 concat: \"x\" + import(cloud)"         setup_concat_dynamic_import            1 "BLOCKED: Cloud import"
run_case "BLOCK-21 unary -: -import(cloud)"               setup_unary_minus_dynamic_import       1 "BLOCKED: Cloud import"
run_case "BLOCK-22 if (ok) import(cloud)"                 setup_conditional_dynamic_import       1 "BLOCKED: Cloud import"
run_case "BLOCK-23 import(\`@sovri/cloud-api\`)"          setup_backtick_dynamic_named           1 "BLOCKED: Cloud import"
run_case "BLOCK-24 import(\`../../apps/cloud-api/...\`)"  setup_backtick_dynamic_relative        1 "BLOCKED: Cloud import"

run_case "BLOCK-13 reports line number prefix"            setup_at_sovri_cloud_in_core_at_line_3 1 "BLOCKED: Cloud import" \
  "3:import { X } from \"@sovri/cloud-api\";"
run_case "BLOCK-14 import type { X } from cloud"          setup_import_type_from_cloud           1 "BLOCKED: Cloud import"
run_case "BLOCK-15 export type { X } from cloud"          setup_export_type_from_cloud           1 "BLOCKED: Cloud import"
run_case "BLOCK-16 multi-line from continuation"          setup_multiline_from_continuation      1 "BLOCKED: Cloud import"
run_case "BLOCK-17 side-effect import \"...\""            setup_side_effect_import               1 "BLOCKED: Cloud import"
run_case "BLOCK-18 dynamic import(\"...\")"               setup_dynamic_import_call              1 "BLOCKED: Cloud import"
run_case "BLOCK-19 require(\"...\") call"                 setup_require_call                     1 "BLOCKED: Cloud import"

TOTAL=$((PASS + FAIL))
echo ""
echo "check-boundary.sh tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
