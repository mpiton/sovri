#!/usr/bin/env bash
# Test runner for scripts/install-hooks.sh.
# Each case spawns an isolated temp git repo with a hermetic PATH built from
# `bin/` — a directory of symlinks to system utilities plus per-case stubs
# for `pnpm`, `lefthook` and `node`. The wrapper script is exercised against
# this PATH so a missing tool truly fails `command -v` and a stubbed tool
# deterministically controls behaviour — without ever running a real `pnpm
# install`. `git` itself must be a real symlink (not a stub) because the
# wrapper now invokes `git rev-parse --show-toplevel` and `git rev-parse
# --git-path hooks` to anchor the repo root and resolve `.git/hooks` even in
# worktrees. Independent of pnpm/Vitest so it runs anywhere bash + git are
# available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/install-hooks.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing or not executable" >&2
  exit 2
fi

PASS=0
FAIL=0
FAILURES=""

# run_case <label> <setup_fn> <expect_exit> <expect_substring> [extra...]
#   setup_fn runs inside a fresh temp repo with cwd at its root and `set -e`
#   enabled, so a failing stub/init aborts visibly. It MUST populate $repo/bin
#   with the tools the script should see. expect_substring may be empty to
#   skip the stdout assertion. Any further arguments are additional
#   substrings that must all be present.
run_case() {
  local label="$1"
  local setup_fn="$2"
  local expect_exit="$3"
  local expect_substring="$4"
  shift 4
  # Capture variadic extras into a named array; iterating "$@" inside the
  # extras loop below would refer to run_case's own args, not the extras.
  local extras=("$@")
  local repo setup_log setup_ec out ec extra

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'install-hooks')
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
    mkdir -p scripts bin
    cp "$SCRIPT" scripts/install-hooks.sh
    chmod +x scripts/install-hooks.sh
    unset GIT_TEMPLATE_DIR GIT_DIR GIT_WORK_TREE
    # Isolate from the host's git config: a contributor with
    # `core.hooksPath` set globally (e.g. a personal hooks dir) would
    # otherwise cause `git rev-parse --git-path hooks` inside the wrapper
    # to resolve outside the temp repo, masking real failures.
    export GIT_CONFIG_GLOBAL=/dev/null
    export GIT_CONFIG_NOSYSTEM=1
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

  # Hermetic PATH: the script and its child processes only see what we placed
  # in $repo/bin. Anything else is invisible — `command -v` correctly reports
  # missing tools, and stubs deterministically control tool behaviour.
  out=$(cd "$repo" && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 PATH="$repo/bin" "$repo/scripts/install-hooks.sh" 2>&1) && ec=0 || ec=$?

  if [ "$ec" -ne "$expect_exit" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: expected exit ${expect_exit}, got ${ec}
$(printf '%s\n' "$out" | sed 's/^/      /')"
    rm -rf "$repo"
    return
  fi

  if [ -n "$expect_substring" ] && ! printf '%s\n' "$out" | grep -Fq -- "$expect_substring"; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}
  ✗ ${label}: stdout missing substring '${expect_substring}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
    rm -rf "$repo"
    return
  fi

  for extra in "${extras[@]}"; do
    if ! printf '%s\n' "$out" | grep -Fq -- "$extra"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}
  ✗ ${label}: stdout missing extra substring '${extra}'
$(printf '%s\n' "$out" | sed 's/^/      /')"
      rm -rf "$repo"
      return
    fi
  done

  PASS=$((PASS + 1))
  rm -rf "$repo"
}

# Helpers — every helper runs inside the case's temp repo, after script copy.

# shim_utils: symlink the small set of system utilities the script + its
# stubs need. bash is required because /usr/bin/env (resolved by the kernel
# from the shebang) does `execvp("bash", ...)` with the script's PATH.
shim_utils() {
  local u p
  for u in bash dirname ls grep mkdir chmod printf cat head sed tr cut; do
    p=$(command -v "$u" 2>/dev/null) || continue
    ln -sf "$p" "bin/$u"
  done
}

# shim_real <name>: symlink a real system binary into bin/. Used for `git`
# because the wrapper now invokes `git rev-parse --show-toplevel` and
# `git rev-parse --git-path hooks` to handle symlinked-script invocations
# and worktree pointer files — a noop stub would fail those calls.
shim_real() {
  local p
  p=$(command -v "$1" 2>/dev/null) || return 1
  ln -sf "$p" "bin/$1"
}

# stub_node_major <major>: fake `node -p 'process.versions.node.split(".")[0]'`
# to return <major>. The wrapper only inspects the major version for the LTS
# warning, so a one-line echo is sufficient.
stub_node_major() {
  local major="$1"
  cat > bin/node <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-p" ]; then
  echo "$major"
  exit 0
fi
exit 0
EOF
  chmod +x bin/node
}

# stub_pnpm: emulate the two pnpm subcommands the script invokes.
#   install: assert the supply-chain flags from ADR-009 + ARCHI §9
#     (`--frozen-lockfile` and `--ignore-scripts`) are forwarded. Any missing
#     flag aborts with exit 1 — so the happy path fails if the wrapper drops
#     a required flag.
#   exec lefthook install: write fake pre-commit + pre-push hook files into
#     .git/hooks/ so the wrapper's verification step succeeds.
stub_pnpm() {
  cat > bin/pnpm <<'EOF'
#!/usr/bin/env bash
case "$1" in
  install)
    shift
    case " $* " in
      *" --frozen-lockfile "*) ;;
      *) echo "STUB: pnpm install missing --frozen-lockfile" >&2; exit 1 ;;
    esac
    case " $* " in
      *" --ignore-scripts "*) ;;
      *) echo "STUB: pnpm install missing --ignore-scripts" >&2; exit 1 ;;
    esac
    exit 0
    ;;
  exec)
    shift
    if [ "$1" = "lefthook" ] && [ "$2" = "install" ]; then
      mkdir -p .git/hooks
      printf '#!/bin/sh\nexit 0\n' > .git/hooks/pre-commit
      printf '#!/bin/sh\nexit 0\n' > .git/hooks/pre-push
      chmod +x .git/hooks/pre-commit .git/hooks/pre-push
      exit 0
    fi
    echo "STUB: pnpm exec called with unexpected args: $*" >&2
    exit 1
    ;;
  *)
    echo "STUB: pnpm called with unexpected subcommand: $*" >&2
    exit 1
    ;;
esac
EOF
  chmod +x bin/pnpm
}

# stub_pnpm_noop_lefthook: install succeeds with required flags, but
# `pnpm exec lefthook install` does NOT write any hook files — exercises
# the wrapper's verification-failure branch.
stub_pnpm_noop_lefthook() {
  cat > bin/pnpm <<'EOF'
#!/usr/bin/env bash
case "$1" in
  install)
    shift
    case " $* " in *" --frozen-lockfile "*) ;; *) exit 1 ;; esac
    case " $* " in *" --ignore-scripts "*) ;; *) exit 1 ;; esac
    exit 0
    ;;
  exec) exit 0 ;;
  *) exit 1 ;;
esac
EOF
  chmod +x bin/pnpm
}

# Drop a .nvmrc with the given pinned version (e.g. 24.11.1). The wrapper
# reads only the major (first .-separated field). Helps prove the magic
# constant has been replaced by the file-driven value.
write_nvmrc() {
  printf '%s\n' "$1" > .nvmrc
}

# Setup fns — one per scenario.

# Happy path: every tool present, node 24, pnpm + lefthook stubbed working,
# .nvmrc pins major 24.
setup_happy() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major 24
  stub_pnpm
}

# Same as happy path but the wrapper script is invoked TWICE — once during
# setup, once via run_case — verifying idempotency. The setup invocation
# runs under `set -e` (inherited from the surrounding subshell), so a non-zero
# exit here aborts the test and run_case reports the setup failure.
setup_idempotent() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major 24
  stub_pnpm
  (GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 PATH="$PWD/bin" ./scripts/install-hooks.sh) >/dev/null
}

# Missing git: bin/ has no `git`, so `command -v git` fails before any git
# invocation. No `git init` in setup — the wrapper must exit on the require
# check alone, without leaning on a pre-existing `.git/` directory.
setup_missing_git() {
  shim_utils
  stub_node_major 24
  stub_pnpm
}

# Missing node.
setup_missing_node() {
  shim_utils
  shim_real git
  git init -q
  stub_pnpm
}

# Missing pnpm.
setup_missing_pnpm() {
  shim_utils
  shim_real git
  git init -q
  stub_node_major 24
}

# Old node (major < pinned LTS): wrapper emits a WARNING but still proceeds.
setup_node_old() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major 20
  stub_pnpm
}

# Future node major: no warning expected.
setup_node_future() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major 99
  stub_pnpm
}

# Non-numeric `node -p` output (`v24`, malformed shim): wrapper must NOT
# abort under `set -e`. It surfaces a parse-warning and continues.
setup_node_nonnumeric() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major "v24"
  stub_pnpm
}

# .nvmrc absent: wrapper falls back to the default pinned major (24). With
# node 20 and no .nvmrc, the LTS warning still fires.
setup_no_nvmrc_warns() {
  shim_utils
  shim_real git
  git init -q
  stub_node_major 20
  stub_pnpm
}

# .nvmrc pinned to a higher major than current node: a contributor who
# preempts the next LTS bump should see the warning even if their node is
# above the previous pinned major.
setup_nvmrc_pins_higher() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 26.0.0
  stub_node_major 24
  stub_pnpm
}

# pnpm exec lefthook is a noop → verification fails.
setup_hooks_not_installed() {
  shim_utils
  shim_real git
  git init -q
  write_nvmrc 24.11.1
  stub_node_major 24
  stub_pnpm_noop_lefthook
}

# Cases.

run_case "PASS-1  happy path: all tools, node 24"             setup_happy           0 "==> Ready." \
  "OK: pnpm" "Pre-commit + pre-push hooks active." "Bypassing hooks with --no-verify is FORBIDDEN"
run_case "PASS-2  idempotent (run twice, second succeeds)"    setup_idempotent      0 "==> Ready."
run_case "PASS-3  node 99 (future major) — no warning"        setup_node_future     0 "==> Ready."
run_case "PASS-4  pnpm install flags forwarded"               setup_happy           0 "==> Installing dependencies"
run_case "PASS-5  hooks verified after install"               setup_happy           0 "==> Verifying hooks installation"
run_case "PASS-6  non-numeric node version → parse-warning"   setup_node_nonnumeric 0 "WARNING: could not parse Node major version"

run_case "WARN-1  node 20 → LTS warning emitted"              setup_node_old        0 "WARNING: Node 20"
run_case "WARN-2  .nvmrc absent → default pin (24) warns 20"  setup_no_nvmrc_warns  0 "WARNING: Node 20"
run_case "WARN-3  .nvmrc pins 26 → node 24 warns"             setup_nvmrc_pins_higher 0 "Sovri requires Node 26 LTS"

run_case "BLOCK-1 missing git → exit 1"                       setup_missing_git     1 "MISSING: git" \
  "Missing tools. Install them then re-run this script."
run_case "BLOCK-2 missing node → exit 1"                      setup_missing_node    1 "MISSING: node"
run_case "BLOCK-3 missing pnpm → exit 1"                      setup_missing_pnpm    1 "MISSING: pnpm"
run_case "BLOCK-4 lefthook noop → hooks-verify fails"         setup_hooks_not_installed 1 "ERROR: hooks not installed"

TOTAL=$((PASS + FAIL))
echo ""
echo "install-hooks.sh tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
