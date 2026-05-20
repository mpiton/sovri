#!/usr/bin/env bash
# Reject staged imports from apps/cloud-api/ within the Apache 2.0 surface.
# Enforces docs/adr/010-licence-apache-2.md: packages/ and
# apps/community-bot/ MUST NOT import from apps/cloud-api/. The Cloud edition
# may import from the Community edition (one-way), never the reverse.
# Invoked at pre-commit via lefthook.yml.
set -euo pipefail

MODE="${1:---staged}"
if [ "$MODE" != "--staged" ] && [ "$MODE" != "--all" ]; then
  echo "Usage: ./scripts/check-boundary.sh [--staged|--all]" >&2
  exit 2
fi

# Public-surface TypeScript only. Deletions are excluded — removing a stale
# cloud import must pass.
if [ "$MODE" = "--all" ]; then
  TARGETS=$(git ls-files | grep -E '^(packages/|apps/community-bot/).*\.(ts|tsx)$' || true)
else
  TARGETS=$(git diff --cached --diff-filter=d --name-only \
    | grep -E '^(packages/|apps/community-bot/).*\.(ts|tsx)$' || true)
fi

[ -z "$TARGETS" ] && exit 0

# Forbidden module specifiers:
#   - @sovri/cloud<anything>       (reserved npm scope for proprietary code)
#   - ../<anything>cloud-api<...>  (relative climb into apps/cloud-api/)
# The relative alternative requires a literal `../` prefix so a sibling
# `./cloud-api-mock` inside packages/ that merely embeds the substring is
# never flagged.
#
# Four import shapes are recognised. All four require the construct to start
# at a real statement boundary so string literals, JSDoc and inline
# comments that mention the forbidden specifier are not mistaken for
# imports:
#
#   1. Single-line `import|export ... from "..."` (incl. `import type`,
#      `export *`, `export type { X } from`) — anchored to start of line.
#   2. Continuation: bare `from "..."` on its own line (after a multi-line
#      destructuring import or re-export) — anchored to start of line.
#   3. Side-effect import: `import "..."` (no `from`, ESM register
#      pattern) — anchored to start of line.
#   4. Dynamic / CJS call: `import("...")` and `require("...")`. The
#      keyword must be in a real statement / expression context; an
#      explicit punctuation whitelist `( , ; = ? : { } ! & | > [`,
#      optionally preceded by `await` / `return` / `yield` / `throw` /
#      `new`, or start-of-line. Bare whitespace, comment markers
#      (`//`, `/*`, `*/`, `*`) and string delimiters (`"`, `'`,
#      backtick) are deliberately NOT recognised as boundaries — that
#      was the false-positive surface reported by the PR #73 review
#      bots (CodeRabbit, Codex, cubic-dev-ai) where `// import("...")`
#      and `/** import("...") */` previously tripped the gate.
#      `\b` is not portable POSIX ERE; we list boundary chars
#      explicitly.
#
# Known limitations: (a) a dynamic import that splits `import(` and the
# quoted specifier across two physical lines slips through; (b) a
# dynamic import inside a multi-line `/* ... */` block comment whose
# body does not start with `*` continuation also slips through (rare in
# practice — JSDoc convention always uses leading `*`); (c) an
# `import(...)` text that appears inside a template literal preceded by
# one of the whitelisted punctuation characters could match in
# pathological cases. The forthcoming pre-push `forbidden-imports`
# Turbo target (ARCHI.md §15.3) is the AST-aware enforcement; this
# pre-commit gate is a fast defense-in-depth layer that catches the
# common breaches in <50 ms.
# `cloud-api` in the relative-climb alternative must be a full path
# segment, not a suffix inside one: the leading `(.*/)?` requires every
# character before `cloud-api` to be either nothing or end with `/`, so
# `../mock-cloud-api/x` and similar are not flagged. The trailing
# `[/'\"]` requires a path or quote boundary after the segment so a
# sibling `../cloud-api-mock` is also rejected as a non-match.
# Dynamic-alternative punctuation whitelist: `+`, `-`, `)` are included
# alongside the original delimiters so expression contexts like
# `"prefix" + import("...")`, `-import("...")` and
# `if (ok) import("...")` are caught. The quote class on the dynamic
# alternative also accepts a backtick so `import(`@sovri/cloud-api`)`
# template-literal specifiers do not bypass the gate.
PATTERN="^[[:space:]]*(import|export)[[:space:]].*from[[:space:]]+['\"](@sovri/cloud([/-][^'\"[:space:]]*)?['\"]|\\.\\./(.*/)?cloud-api[/'\"])|^[[:space:]]*(import|from)[[:space:]]+['\"](@sovri/cloud([/-][^'\"[:space:]]*)?['\"]|\\.\\./(.*/)?cloud-api[/'\"])|(^[[:space:]]*((await|return|yield|throw|new)[[:space:]]+)?|[()\\,;=?:{}!&|>+\\[\\-][[:space:]]*((await|return|yield|throw|new)[[:space:]]+)?|[[:space:]](await|return|yield|throw|new)[[:space:]]+)(import|require)[[:space:]]*\\([[:space:]]*['\"\`](@sovri/cloud([/-][^'\"\`[:space:]]*)?['\"\`]|\\.\\./(.*/)?cloud-api[/'\"\`])"

# Strip comments before scanning so commented-out example code that
# happens to embed `import(...)` / `require(...)` / `from "..."` text
# never trips the gate. Four passes, all line-local:
#   - inline `/* ... */` block comments on a single line,
#   - whole-line `//` comments (leading whitespace allowed),
#   - JSDoc body continuation lines (leading whitespace + `*`),
#   - trailing `//` comments preceded by whitespace (so `http://...`
#     inside a string is preserved, since `//` is preceded by `:`).
# Multi-line `/* ... */` blocks that span lines and `import(...)` text
# inside template literals are NOT stripped here — the pre-push
# AST-aware `forbidden-imports` gate is the heavy enforcement.
strip_comments() {
  sed -E -e 's@/\*.*\*/@@g' \
         -e 's@^[[:space:]]*//.*$@@' \
         -e 's@^[[:space:]]*\*.*$@@' \
         -e 's@([[:space:]])//.*$@\1@'
}

BAD=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  # Read the staged blob from the index, not the working tree, so a
  # partially-staged file is evaluated exactly as it will land in the
  # commit. Skip only on genuine `git show` failure (e.g. a race with
  # `git restore --staged`); an empty staged blob is still scanned and
  # passes naturally because it contains no imports.
  if [ "$MODE" = "--all" ]; then
    staged=$(tr -d '\000' < "$file" 2>/dev/null || true)
  else
    if ! staged=$(git show ":$file" 2>/dev/null | tr -d '\000'); then
      continue
    fi
  fi
  cleaned=$(printf '%s\n' "$staged" | strip_comments)
  hits=$(printf '%s\n' "$cleaned" | grep -nE "$PATTERN" || true)
  if [ -n "$hits" ]; then
    BAD="${BAD}${file}
$(printf '%s\n' "$hits" | sed 's/^/  /')
"
  fi
done <<< "$TARGETS"

if [ -n "$BAD" ]; then
  echo "BLOCKED: Cloud import in public surface (ADR-010 boundary breach):"
  printf '%s' "$BAD"
  echo ""
  echo "packages/ and apps/community-bot/ MUST NOT import from apps/cloud-api/."
  echo "These directories ship under Apache 2.0 (docs/adr/010-licence-apache-2.md);"
  echo "apps/cloud-api/ is proprietary. The only permitted direction is:"
  echo "  apps/cloud-api/        ->  packages/*               (allowed)"
  echo "  packages/*             ->  apps/cloud-api/          (blocked, this guard)"
  echo "  apps/community-bot/    ->  apps/cloud-api/          (blocked, this guard)"
  echo ""
  echo "Remove the listed import(s)."
  exit 1
fi

exit 0
