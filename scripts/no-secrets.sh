#!/usr/bin/env bash
# Reject staged files likely to contain secrets.
# Invoked at pre-commit via lefthook.yml.
set -euo pipefail

# Secret-file patterns. The directory alternative is anchored to either repo
# root or a path component boundary so that `docs/secrets/overview.md` (no
# leading dot) is not flagged, while `.aws/credentials` and `apps/foo/.env`
# still are.
SECRET_PATTERNS='\.(env|env\..+|pem|key|p12|pfx|secret|creds|aws|netrc)$|(^|/)\.(env|secrets|aws)/|(^|/)\.(npmrc|pypirc)$'

STAGED=$(git diff --cached --diff-filter=d --name-only)
[ -z "$STAGED" ] && exit 0

# Filename check. `.env.example` (and `.env.<suffix>.example`) is the only
# template family whitelisted.
SECRET_FILES=$(
  printf '%s\n' "$STAGED" \
    | grep -iE "$SECRET_PATTERNS" \
    | grep -ivE '(^|/)\.env(\.[^/]+)?\.example$' \
    || true
)

if [ -n "$SECRET_FILES" ]; then
  echo "BLOCKED: files possibly containing secrets staged:"
  printf '%s\n' "$SECRET_FILES" | sed 's/^/  - /'
  echo ""
  echo "If intentional, add the file to .gitignore and use a .example variant instead."
  exit 1
fi

# Content check: grep known API key patterns in the staged diff.
# Exclude every `package.json` and `pnpm-lock.yaml` across the monorepo —
# they routinely contain long hex / sha-256 / integrity strings that collide
# with `sk-[A-Za-z0-9_-]{32,}` and similar patterns. ADR-012 requires every
# local hook to have a matching CI counterpart with the same exclusions.
# The grep is case-sensitive on purpose: the seven prefixes are canonical
# case (`AKIA`, `AIza`, `sk-ant-`, etc.), so `-iE` would create false
# positives on random uppercase/lowercase identifiers.
CONTENT_LEAK=$(git diff --cached -U0 \
    -- ':(exclude,glob)**/pnpm-lock.yaml' ':(exclude,glob)**/package.json' \
  | grep -E '^\+' \
  | grep -vE '^\+\+\+ ' \
  | grep -E \
      -e 'AKIA[0-9A-Z]{16}' \
      -e 'sk-ant-[A-Za-z0-9_-]{20,}' \
      -e 'sk-[A-Za-z0-9_-]{32,}' \
      -e 'ghp_[A-Za-z0-9]{36}' \
      -e 'github_pat_[A-Za-z0-9_]{82}' \
      -e 'glpat-[A-Za-z0-9_-]{20}' \
      -e 'AIza[0-9A-Za-z_-]{35}' \
  || true)

if [ -n "$CONTENT_LEAK" ]; then
  echo "BLOCKED: API key pattern detected in diff:"
  printf '%s\n' "$CONTENT_LEAK" | head -5
  echo ""
  echo "Remove the key and revoke it immediately if it has been committed even locally."
  exit 1
fi

exit 0
