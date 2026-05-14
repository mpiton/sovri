#!/usr/bin/env bash
# Sovri onboarding installer: dependencies + git hooks + sanity checks.
# Usage: ./scripts/install-hooks.sh
# Reference: ARCHI.md §16.2.
set -euo pipefail

echo "==> Checking required tools"

# require <name> <install-hint> -> 0 if present, 1 if missing (prints both cases).
require() {
  name="$1"
  install_hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "MISSING: $name"
    echo "  Install: $install_hint"
    return 1
  fi
  echo "OK: $name ($(command -v "$name"))"
}

missing=0
require git "https://git-scm.com/downloads" || missing=1
require node "https://nodejs.org (use the version pinned in .nvmrc)" || missing=1
require pnpm "corepack enable && corepack prepare pnpm@10 --activate" || missing=1

if [ "$missing" -eq 1 ]; then
  echo ""
  echo "Missing tools. Install them then re-run this script."
  exit 1
fi

# Anchor at the repo root via git rather than `dirname "$0"`: handles any cwd
# the caller happened to pick. Falls back to the directory containing this
# script when git cannot locate a worktree (e.g. running from a tarball
# checkout). First resolve `BASH_SOURCE[0]` through any chain of symlinks so
# a PATH-shim like `~/bin/sovri-install -> .../scripts/install-hooks.sh`
# lands on the real script directory — `dirname "$0"` alone would yield the
# symlink's parent (`~/bin/`), git rev-parse would then fail outside the
# repo and the fallback would run `pnpm install` in the wrong tree. POSIX
# `readlink` (no `-f`) is used so the resolution does not depend on GNU
# coreutils.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  LINK_DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="$LINK_DIR/$SOURCE" ;;
  esac
done
SCRIPT_DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SCRIPT_DIR")
cd "$REPO_ROOT"

# Read the pinned Node major from `.nvmrc` (single source of truth — also
# referenced by ADR-001 and CI). Default to 24 only if .nvmrc is unreadable so
# a missing file does not silently disable the warning.
if [ -r .nvmrc ]; then
  PINNED_NODE_MAJOR=$(head -n 1 .nvmrc | cut -d. -f1)
else
  PINNED_NODE_MAJOR=24
fi

# Warn (do not block) if Node major is below the pinned LTS. The value
# returned by `node -p` is trusted to be a small integer, but a malformed
# node binary or shim could emit `v24`, an empty string, or non-numeric
# text — under `set -euo pipefail` an arithmetic test on those values would
# abort the whole installer with a cryptic error, turning a soft warning
# into a hard block. Validate the shape first; if it does not parse, surface
# a friendly warning and continue.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
case "$NODE_MAJOR" in
  ''|*[!0-9]*)
    echo "WARNING: could not parse Node major version (got '$NODE_MAJOR'). Continuing."
    ;;
  *)
    if [ "$NODE_MAJOR" -lt "$PINNED_NODE_MAJOR" ]; then
      echo "WARNING: Node $NODE_MAJOR detected, Sovri requires Node $PINNED_NODE_MAJOR LTS (.nvmrc)."
    fi
    ;;
esac

echo ""
echo "==> Installing dependencies (pnpm, --frozen-lockfile, --ignore-scripts)"
pnpm install --frozen-lockfile --ignore-scripts

echo ""
echo "==> Installing lefthook git hooks"
pnpm exec lefthook install

echo ""
echo "==> Verifying hooks installation"
# Resolve the hooks directory via git so the check is correct for plain
# repos, worktrees (where `.git` is a pointer file, not a directory), and
# any `GIT_DIR` override. Check exact filenames because `git init` always
# seeds `.git/hooks/*.sample` siblings — a pattern match would yield a
# false positive when lefthook installed nothing.
HOOKS_DIR=$(git rev-parse --git-path hooks 2>/dev/null || echo ".git/hooks")
# Check both existence and executability: git silently refuses to run a hook
# file that is not executable, so a `-f`-only check would report success
# while the hooks effectively do nothing on commit/push.
if [ ! -f "$HOOKS_DIR/pre-commit" ] || [ ! -x "$HOOKS_DIR/pre-commit" ] || \
   [ ! -f "$HOOKS_DIR/pre-push" ] || [ ! -x "$HOOKS_DIR/pre-push" ]; then
  echo "ERROR: hooks not installed (or not executable) in $HOOKS_DIR/"
  exit 1
fi

echo ""
echo "==> Ready."
echo "    Pre-commit + pre-push hooks active."
echo "    Bypassing hooks with --no-verify is FORBIDDEN. Fix the root cause instead."
