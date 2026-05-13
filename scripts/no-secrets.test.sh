#!/usr/bin/env bash
# Test runner for scripts/no-secrets.sh.
# Spawns isolated temporary git repositories and verifies each acceptance
# scenario from issue #7. Independent of pnpm/Vitest so it runs anywhere bash
# and git are available.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SCRIPT_DIR/no-secrets.sh"

if [ ! -x "$SCRIPT" ]; then
  echo "ERROR: $SCRIPT is missing or not executable" >&2
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

  repo=$(mktemp -d 2>/dev/null || mktemp -d -t 'no-secrets')
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

# Shared helpers (must be functions so callers may declare locals).

make_clean_code() {
  mkdir -p src
  echo 'export const x = 1;' > src/foo.ts
  git add src/foo.ts
}

make_block_file() {
  local fname="$1"
  echo 'secret' > "$fname"
  git add "$fname"
}

make_block_content() {
  local key="$1"
  mkdir -p src
  echo "const k = \"$key\";" > src/leak.ts
  git add src/leak.ts
}

make_pass_content() {
  local val="$1"
  mkdir -p src
  echo "const x = \"$val\";" > src/clean.ts
  git add src/clean.ts
}

repeat_a() {
  printf 'a%.0s' $(seq 1 "$1")
}

# Pass scenarios.

setup_empty() { :; }
setup_clean_code() { make_clean_code; }
setup_env_example() { echo 'KEY=value' > .env.example; git add .env.example; }
setup_env_prod_example() { echo 'KEY=value' > .env.production.example; git add .env.production.example; }
setup_docs_secrets() {
  mkdir -p docs/secrets
  echo '# overview' > docs/secrets/overview.md
  git add docs/secrets/overview.md
}
setup_lowercase_akia() { make_pass_content "akia0123456789abcdef"; }

setup_root_lock_excluded() {
  printf 'foo: AKIAIOSFODNN7EXAMPLE\n' > pnpm-lock.yaml
  git add pnpm-lock.yaml
  make_clean_code
}

setup_root_pkgjson_excluded() {
  local long_sk
  long_sk=$(repeat_a 40)
  printf '{"name":"x","foo":"sk-%s"}\n' "$long_sk" > package.json
  git add package.json
  make_clean_code
}

setup_nested_lock_excluded() {
  mkdir -p apps/x
  printf 'foo: AKIAIOSFODNN7EXAMPLE\n' > apps/x/pnpm-lock.yaml
  git add apps/x/pnpm-lock.yaml
  make_clean_code
}

setup_nested_pkgjson_excluded() {
  local long_sk
  long_sk=$(repeat_a 40)
  mkdir -p apps/x
  printf '{"name":"x","foo":"sk-%s"}\n' "$long_sk" > apps/x/package.json
  git add apps/x/package.json
  make_clean_code
}

# Block file scenarios.

setup_env() { make_block_file .env; }
setup_env_prod() { make_block_file .env.production; }
setup_pem() { make_block_file my.pem; }
setup_key() { make_block_file my.key; }
setup_p12() { make_block_file cert.p12; }
setup_pfx() { make_block_file cert.pfx; }
setup_secret() { make_block_file token.secret; }
setup_creds() { make_block_file .creds; }
setup_aws_ext() { make_block_file profile.aws; }
setup_netrc() { make_block_file .netrc; }
setup_npmrc() { make_block_file .npmrc; }
setup_pypirc() { make_block_file .pypirc; }
setup_nested_npmrc() {
  mkdir -p apps/x
  echo '//registry.npmjs.org/:_authToken=fake' > apps/x/.npmrc
  git add apps/x/.npmrc
}
setup_nested_pypirc() {
  mkdir -p apps/x
  echo '[pypi]' > apps/x/.pypirc
  git add apps/x/.pypirc
}
setup_aws_dir() {
  mkdir -p .aws
  echo 'aws_secret_access_key=fake' > .aws/credentials
  git add .aws/credentials
}

# Block content scenarios.

setup_akia() { make_block_content "AKIAIOSFODNN7EXAMPLE"; }
setup_sk_ant() { make_block_content "sk-ant-$(repeat_a 30)"; }
setup_sk_ant_api03() { make_block_content "sk-ant-api03-$(repeat_a 90)Z"; }
setup_sk_generic() { make_block_content "sk-$(repeat_a 40)"; }
setup_sk_proj() { make_block_content "sk-proj-$(repeat_a 20)_b_c-d-e-f$(repeat_a 20)"; }
setup_ghp() { make_block_content "ghp_$(repeat_a 36)"; }
setup_github_pat() { make_block_content "github_pat_$(repeat_a 82)"; }
setup_glpat() { make_block_content "glpat-$(repeat_a 20)"; }
setup_aiza() { make_block_content "AIza$(repeat_a 35)"; }

# Cases.

run_case "PASS-1  empty staged set"           setup_empty                    0 ""
run_case "PASS-2  clean code file"            setup_clean_code               0 ""
run_case "PASS-3  .env.example allowed"       setup_env_example              0 ""
run_case "PASS-4  .env.production.example"    setup_env_prod_example         0 ""
run_case "PASS-5  root pnpm-lock.yaml excl"   setup_root_lock_excluded       0 ""
run_case "PASS-6  root package.json excl"     setup_root_pkgjson_excluded    0 ""
run_case "PASS-7  nested pnpm-lock.yaml excl" setup_nested_lock_excluded     0 ""
run_case "PASS-8  nested package.json excl"   setup_nested_pkgjson_excluded  0 ""
run_case "PASS-9  docs/secrets/ allowed"      setup_docs_secrets             0 ""
run_case "PASS-10 lowercase akia ignored"     setup_lowercase_akia           0 ""

run_case "BLOCK-1  .env"                  setup_env             1 "BLOCKED: files"
run_case "BLOCK-2  .env.production"       setup_env_prod        1 "BLOCKED: files"
run_case "BLOCK-3  *.pem"                 setup_pem             1 "BLOCKED: files"
run_case "BLOCK-4  *.key"                 setup_key             1 "BLOCKED: files"
run_case "BLOCK-5  *.p12"                 setup_p12             1 "BLOCKED: files"
run_case "BLOCK-6  *.pfx"                 setup_pfx             1 "BLOCKED: files"
run_case "BLOCK-7  *.secret"              setup_secret          1 "BLOCKED: files"
run_case "BLOCK-8  .creds"                setup_creds           1 "BLOCKED: files"
run_case "BLOCK-9  *.aws extension"       setup_aws_ext         1 "BLOCKED: files"
run_case "BLOCK-10 .netrc"                setup_netrc           1 "BLOCKED: files"
run_case "BLOCK-11 .npmrc"                setup_npmrc           1 "BLOCKED: files"
run_case "BLOCK-12 .pypirc"               setup_pypirc          1 "BLOCKED: files"
run_case "BLOCK-13 nested .npmrc"         setup_nested_npmrc    1 "BLOCKED: files"
run_case "BLOCK-14 nested .pypirc"        setup_nested_pypirc   1 "BLOCKED: files"
run_case "BLOCK-15 .aws/credentials"      setup_aws_dir         1 "BLOCKED: files"

run_case "BLOCK-16 AKIA key"              setup_akia            1 "BLOCKED: API key"
run_case "BLOCK-17 sk-ant minimal"        setup_sk_ant          1 "BLOCKED: API key"
run_case "BLOCK-18 sk-ant-api03 realistic" setup_sk_ant_api03   1 "BLOCKED: API key"
run_case "BLOCK-19 sk- generic"           setup_sk_generic      1 "BLOCKED: API key"
run_case "BLOCK-20 sk-proj- with _-"      setup_sk_proj         1 "BLOCKED: API key"
run_case "BLOCK-21 ghp_ token"            setup_ghp             1 "BLOCKED: API key"
run_case "BLOCK-22 github_pat_"           setup_github_pat      1 "BLOCKED: API key"
run_case "BLOCK-23 glpat-"                setup_glpat           1 "BLOCKED: API key"
run_case "BLOCK-24 AIza key"              setup_aiza            1 "BLOCKED: API key"

TOTAL=$((PASS + FAIL))
echo ""
echo "no-secrets.sh tests: $PASS/$TOTAL passed"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi

exit 0
