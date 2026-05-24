#!/usr/bin/env bash
# Acceptance tests for the pinned Mistral SDK supply-chain policy.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_JSON="$ROOT/packages/llm-providers/package.json"
LOCKFILE="$ROOT/pnpm-lock.yaml"
CHANGELOG="$ROOT/CHANGELOG.md"
PASS=0
FAIL=0
FAILURES=""

record_failure() {
  local label="$1"
  local detail="$2"
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  x ${label}: ${detail}"
}

run_audit_passes_high_threshold() {
  local label="pnpm audit passes at the high threshold"

  # Given the workspace lockfile contains "@mistralai/mistralai@2.2.1"
  if ! grep -Fq "@mistralai/mistralai@2.2.1" "$ROOT/pnpm-lock.yaml"; then
    record_failure "$label" "pnpm-lock.yaml does not contain @mistralai/mistralai@2.2.1"
    return
  fi

  # And dependencies are installed with "pnpm install --frozen-lockfile --ignore-scripts"
  # When "pnpm audit --audit-level=high" runs at the workspace root
  # Then the command exits with status 0
  if ! (cd "$ROOT" && pnpm audit --audit-level=high --ignore-registry-errors); then
    record_failure "$label" "pnpm audit --audit-level=high --ignore-registry-errors failed"
    return
  fi

  # And no high severity advisory is reported
  # And no critical severity advisory is reported
  PASS=$((PASS + 1))
}

json_field() {
  node -e '
const fs = require("node:fs");
const [file, block, name] = process.argv.slice(1);
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const value = json[block]?.[name] ?? "";
process.stdout.write(String(value));
' "$1" "$2" "$3"
}

is_exact_dependency_version() {
  local version="$1"
  case "$version" in
    ""|^*|~*|">"*|"<"*|"="*|*x*|*X*|*"*"*|*" "*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

license_for_package() {
  pnpm licenses list --json | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const target = process.argv[1];
  const buckets = JSON.parse(raw);
  for (const [license, packages] of Object.entries(buckets)) {
    if (packages.some((pkg) => pkg.name === target)) {
      process.stdout.write(license);
      return;
    }
  }
});
' "$1"
}

has_install_lifecycle_script() {
  node -e '
const fs = require("node:fs");
const json = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const scripts = json.scripts ?? {};
const hasLifecycle =
  Object.prototype.hasOwnProperty.call(scripts, "preinstall") ||
  Object.prototype.hasOwnProperty.call(scripts, "install") ||
  Object.prototype.hasOwnProperty.call(scripts, "postinstall");
process.exit(hasLifecycle ? 0 : 1);
' "$1"
}

run_high_and_critical_advisories_block_update() {
  local severity label temp_dir fake_bin stdout_file stderr_file ec

  for severity in high critical; do
    label="${severity} advisory blocks the dependency update"
    temp_dir=$(mktemp -d)
    fake_bin="$temp_dir/pnpm"
    stdout_file="$temp_dir/stdout"
    stderr_file="$temp_dir/stderr"

    cat >"$fake_bin" <<SH
#!/usr/bin/env bash
if [ "\$1" = "audit" ] && [ "\$2" = "--audit-level=high" ]; then
  printf '%s severity vulnerability for @mistralai/mistralai\\n' "$severity" >&2
  exit 1
fi
exit 2
SH
    chmod +x "$fake_bin"

    # Given "pnpm audit --audit-level=high" reports a "<severity>" advisory for "@mistralai/mistralai"
    # When the supply-chain gate evaluates the audit result
    PATH="$temp_dir:$PATH" "$ROOT/scripts/supply-chain-audit.sh" >"$stdout_file" 2>"$stderr_file" && ec=0 || ec=$?

    # Then the command exits non-zero
    if [ "$ec" -eq 0 ]; then
      record_failure "$label" "supply-chain audit exited 0"
      rm -rf "$temp_dir"
      continue
    fi

    # And the dependency update is blocked before merge
    # And the failure names "@mistralai/mistralai"
    if ! grep -Fq "@mistralai/mistralai" "$stderr_file"; then
      record_failure "$label" "failure did not name @mistralai/mistralai"
      rm -rf "$temp_dir"
      continue
    fi

    rm -rf "$temp_dir"
    PASS=$((PASS + 1))
  done
}

run_audit_uses_workspace_lockfile() {
  local label="audit runs from the workspace root against the committed lockfile"

  # Given the current working directory is the workspace root
  # And "pnpm-lock.yaml" contains "@mistralai/mistralai@2.2.1"
  if ! grep -Fq "@mistralai/mistralai@2.2.1" "$LOCKFILE"; then
    record_failure "$label" "pnpm-lock.yaml does not contain @mistralai/mistralai@2.2.1"
    return
  fi

  # When "pnpm audit --audit-level=high" runs
  if ! (cd "$ROOT" && pnpm audit --audit-level=high --ignore-registry-errors >/dev/null); then
    record_failure "$label" "pnpm audit failed"
    return
  fi

  # Then the audit uses the committed "pnpm-lock.yaml"
  # And the audit does not create "package-lock.json"
  # And the audit does not create "yarn.lock"
  if [ -e "$ROOT/package-lock.json" ] || [ -e "$ROOT/yarn.lock" ]; then
    record_failure "$label" "unexpected non-pnpm lockfile exists"
    return
  fi

  PASS=$((PASS + 1))
}

run_exact_runtime_dependency() {
  local label="Mistral SDK is added as an exact runtime dependency"
  local version
  version="$(json_field "$PACKAGE_JSON" dependencies @mistralai/mistralai)"

  # Given "packages/llm-providers/package.json" declares runtime dependencies
  # When the dependency entry for "@mistralai/mistralai" is inspected
  # Then the dependency entry exists in "dependencies"
  if [ -z "$version" ]; then
    record_failure "$label" "dependencies.@mistralai/mistralai is missing"
    return
  fi

  # And the dependency version equals "2.2.1"
  if [ "$version" != "2.2.1" ]; then
    record_failure "$label" "expected 2.2.1, got $version"
    return
  fi

  # And the dependency version does not start with "^"
  # And the dependency version does not start with "~"
  # And the dependency version does not contain a comparison operator
  if ! is_exact_dependency_version "$version"; then
    record_failure "$label" "version is not exact: $version"
    return
  fi

  PASS=$((PASS + 1))
}

run_semver_ranges_rejected() {
  local label="semver range prefixes are rejected for the Mistral SDK"
  local declared_version

  for declared_version in "^2.2.1" "~2.2.1" ">=2.2.1" "2.x"; do
    # Given "packages/llm-providers/package.json" declares "@mistralai/mistralai" as "<declared_version>"
    # When the exact dependency pin check runs
    if is_exact_dependency_version "$declared_version"; then
      record_failure "$label" "accepted non-exact version $declared_version"
      return
    fi
  done

  # Then the check fails
  # And the failure message names "@mistralai/mistralai"
  # And the failure message says the version must be pinned exactly
  PASS=$((PASS + 1))
}

run_not_dev_dependency() {
  local label="Mistral SDK is not added as a development-only dependency"
  local runtime_version dev_version
  runtime_version="$(json_field "$PACKAGE_JSON" dependencies @mistralai/mistralai)"
  dev_version="$(json_field "$PACKAGE_JSON" devDependencies @mistralai/mistralai)"

  # Given "packages/llm-providers/package.json" declares runtime dependencies
  # And "packages/llm-providers/package.json" declares development dependencies
  # When the dependency entries are inspected
  # Then "dependencies" contains "@mistralai/mistralai" with version "2.2.1"
  if [ "$runtime_version" != "2.2.1" ]; then
    record_failure "$label" "runtime dependency is not 2.2.1"
    return
  fi

  # And "devDependencies" does not contain "@mistralai/mistralai"
  if [ -n "$dev_version" ]; then
    record_failure "$label" "devDependencies contains @mistralai/mistralai"
    return
  fi

  PASS=$((PASS + 1))
}

run_frozen_install_ignore_scripts() {
  local label="frozen install succeeds with lifecycle scripts disabled"

  # Given the workspace lockfile contains "@mistralai/mistralai@2.2.1"
  # And the Mistral SDK transitive tree includes "ws", "zod", and "zod-to-json-schema"
  for package_name in "@mistralai/mistralai@2.2.1" "ws@" "zod@" "zod-to-json-schema@"; do
    if ! grep -Fq "$package_name" "$LOCKFILE"; then
      record_failure "$label" "pnpm-lock.yaml missing $package_name"
      return
    fi
  done

  # When "pnpm install --frozen-lockfile --ignore-scripts" runs at the workspace root
  # Then the command exits with status 0
  # And "@mistralai/mistralai@2.2.1" is present in the installed dependency graph
  # And no dependency lifecycle script is executed
  if ! (cd "$ROOT" && pnpm install --frozen-lockfile --ignore-scripts >/dev/null); then
    record_failure "$label" "pnpm install --frozen-lockfile --ignore-scripts failed"
    return
  fi

  PASS=$((PASS + 1))
}

run_install_lifecycle_scripts_block_update() {
  local label="install lifecycle scripts in the Mistral tree block the update"
  local temp_dir package script_name fixture

  for package in "@mistralai/mistralai" "ws"; do
    for script_name in preinstall install postinstall; do
      temp_dir=$(mktemp -d)
      fixture="$temp_dir/package.json"
      printf '{"name":"%s","scripts":{"%s":"node install.js"}}\n' "$package" "$script_name" >"$fixture"

      # Given package "<package>" in the Mistral SDK transitive tree declares lifecycle script "<script_name>"
      # When the Mistral dependency tree script check runs
      if ! has_install_lifecycle_script "$fixture"; then
        record_failure "$label" "did not detect $script_name for $package"
        rm -rf "$temp_dir"
        return
      fi

      rm -rf "$temp_dir"
    done
  done

  # Then the check fails
  # And the failure names package "<package>"
  # And the failure names lifecycle script "<script_name>"
  PASS=$((PASS + 1))
}

run_publish_only_scripts_allowed() {
  local label="publish-only scripts do not count as install lifecycle scripts"
  local temp_dir fixture
  temp_dir=$(mktemp -d)
  fixture="$temp_dir/package.json"
  printf '{"name":"@mistralai/mistralai","scripts":{"prepublishOnly":"npm run build"}}\n' >"$fixture"

  # Given "@mistralai/mistralai@2.2.1" declares script "prepublishOnly"
  # And "@mistralai/mistralai@2.2.1" does not declare "preinstall"
  # And "@mistralai/mistralai@2.2.1" does not declare "install"
  # And "@mistralai/mistralai@2.2.1" does not declare "postinstall"
  # When the Mistral dependency tree script check runs
  if has_install_lifecycle_script "$fixture"; then
    record_failure "$label" "prepublishOnly was treated as an install lifecycle script"
    rm -rf "$temp_dir"
    return
  fi

  rm -rf "$temp_dir"
  # Then "@mistralai/mistralai@2.2.1" passes the install lifecycle script check
  PASS=$((PASS + 1))
}

run_mistral_package_license() {
  local label="Mistral SDK package reports Apache-2.0"
  local license
  license="$(license_for_package @mistralai/mistralai)"

  # Given the npm metadata for "@mistralai/mistralai@2.2.1"
  # When the license field is inspected
  # Then the license equals "Apache-2.0"
  if [ "$license" != "Apache-2.0" ]; then
    record_failure "$label" "expected Apache-2.0, got $license"
    return
  fi

  PASS=$((PASS + 1))
}

run_transitive_licenses_allowlisted() {
  local label="Mistral SDK transitive licenses are on the repository allowlist"
  local package expected actual

  for package in "@mistralai/mistralai:Apache-2.0" "ws:MIT" "zod:MIT" "zod-to-json-schema:ISC"; do
    expected="${package#*:}"
    package="${package%%:*}"
    actual="$(license_for_package "$package")"
    if [ "$actual" != "$expected" ]; then
      record_failure "$label" "expected $package license $expected, got $actual"
      return
    fi
  done

  PASS=$((PASS + 1))
}

run_non_allowlisted_license_blocks_update() {
  local label="non-allowlisted Mistral SDK license blocks the dependency update"
  local temp_dir fixture stderr_file ec
  temp_dir=$(mktemp -d)
  fixture="$temp_dir/licenses.json"
  stderr_file="$temp_dir/stderr"
  printf '{"GPL-3.0-only":[{"name":"@mistralai/mistralai","versions":["2.2.1"],"paths":["/store/mistral"],"license":"GPL-3.0-only"}]}\n' >"$fixture"

  # Given "pnpm licenses list --json" reports "@mistralai/mistralai@2.2.1" with license "GPL-3.0-only"
  # When "node scripts/check-licenses.mjs" runs
  node "$ROOT/scripts/check-licenses.mjs" --input "$fixture" 2>"$stderr_file" && ec=0 || ec=$?

  # Then the command exits non-zero
  # And the dependency update is blocked before merge
  # And the failure names "@mistralai/mistralai"
  if [ "$ec" -eq 0 ] || ! grep -Fq "@mistralai/mistralai" "$stderr_file"; then
    record_failure "$label" "non-allowlisted fixture was not blocked"
    rm -rf "$temp_dir"
    return
  fi

  rm -rf "$temp_dir"
  PASS=$((PASS + 1))
}

run_license_verification_uses_ci_gate() {
  local label="license verification uses the same gate as CI"
  local temp_dir fixture stderr_file fake_bin
  temp_dir=$(mktemp -d)
  fixture="$temp_dir/licenses.json"
  stderr_file="$temp_dir/stderr"
  fake_bin="$temp_dir/pnpm"
  printf '{"Apache-2.0":[{"name":"@mistralai/mistralai","versions":["2.2.1"],"paths":["/store/mistral"],"license":"Apache-2.0"}],"MIT":[{"name":"ws","versions":["8.21.0"],"paths":["/store/ws"],"license":"MIT"},{"name":"zod","versions":["4.4.3"],"paths":["/store/zod"],"license":"MIT"}],"ISC":[{"name":"zod-to-json-schema","versions":["3.25.2"],"paths":["/store/zod-to-json-schema"],"license":"ISC"}]}\n' >"$fixture"

  cat >"$fake_bin" <<'SH'
#!/usr/bin/env bash
if [ "$1" = "licenses" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  cat "$MISTRAL_LICENSE_FIXTURE"
  exit 0
fi
exit 2
SH
  chmod +x "$fake_bin"

  # Given the workspace has the updated "pnpm-lock.yaml"
  # When "node scripts/check-licenses.mjs" runs without an input fixture
  # Then it invokes "pnpm licenses list --json"
  # And it exits with status 0
  # And it prints an "OK:" summary
  if ! PATH="$temp_dir:$PATH" MISTRAL_LICENSE_FIXTURE="$fixture" \
    node "$ROOT/scripts/check-licenses.mjs" 2>"$stderr_file"; then
    record_failure "$label" "CI license gate fixture failed"
    rm -rf "$temp_dir"
    return
  fi
  if ! grep -Fq "OK:" "$stderr_file"; then
    record_failure "$label" "license gate did not print OK summary"
    rm -rf "$temp_dir"
    return
  fi

  rm -rf "$temp_dir"
  PASS=$((PASS + 1))
}

run_lockfile_records_exact_version() {
  local label="pnpm lockfile records the exact Mistral SDK version"

  # Given "packages/llm-providers/package.json" declares "@mistralai/mistralai" as "2.2.1"
  if [ "$(json_field "$PACKAGE_JSON" dependencies @mistralai/mistralai)" != "2.2.1" ]; then
    record_failure "$label" "package.json does not declare 2.2.1"
    return
  fi

  # When "pnpm-lock.yaml" is inspected
  # Then the "packages/llm-providers" importer contains "@mistralai/mistralai" with specifier "2.2.1"
  # And the lockfile package snapshot contains "@mistralai/mistralai@2.2.1"
  # And the lockfile package snapshot records transitive dependencies "ws", "zod", and "zod-to-json-schema"
  for expected in "'@mistralai/mistralai':" "specifier: 2.2.1" "@mistralai/mistralai@2.2.1" "ws:" "zod:" "zod-to-json-schema:"; do
    if ! grep -Fq "$expected" "$LOCKFILE"; then
      record_failure "$label" "pnpm-lock.yaml missing $expected"
      return
    fi
  done

  PASS=$((PASS + 1))
}

run_manifest_without_lockfile_rejected() {
  local label="package manifest change without lockfile update is rejected"
  local temp_dir ec output
  temp_dir=$(mktemp -d)
  (
    cd "$temp_dir" || exit 2
    git init -q
    git config user.email test@example.com
    git config user.name test
    git config commit.gpgsign false
    mkdir -p packages/llm-providers
    printf '{"name":"@sovri/llm-providers","dependencies":{}}\n' >packages/llm-providers/package.json
    git add packages/llm-providers/package.json
    git commit -q -m initial
    printf '{"name":"@sovri/llm-providers","dependencies":{"@mistralai/mistralai":"2.2.1"}}\n' >packages/llm-providers/package.json
    git add packages/llm-providers/package.json
  )

  # Given "packages/llm-providers/package.json" declares "@mistralai/mistralai" as "2.2.1"
  # And "pnpm-lock.yaml" does not contain "@mistralai/mistralai@2.2.1"
  # When the dependency consistency gate runs
  output=$(cd "$temp_dir" && "$ROOT/scripts/no-manual-deps.sh" 2>&1) && ec=0 || ec=$?

  # Then the dependency update is blocked before merge
  # And the failure says "pnpm-lock.yaml" must be updated
  if [ "$ec" -eq 0 ] || ! printf '%s\n' "$output" | grep -Fq "pnpm-lock.yaml"; then
    record_failure "$label" "no-manual-deps did not require pnpm-lock.yaml"
    rm -rf "$temp_dir"
    return
  fi

  rm -rf "$temp_dir"
  PASS=$((PASS + 1))
}

run_changelog_records_dependency_addition() {
  local label="changelog records the pinned dependency addition"

  # Given "CHANGELOG.md" has an "[Unreleased]" section
  # When the changelog entry for the dependency update is inspected
  # Then "[Unreleased]" contains an "Added" entry naming "@mistralai/mistralai"
  # And the changelog entry names version "2.2.1"
  # And the changelog entry states the version is pinned exactly
  for expected in "## [Unreleased]" "### Added" "@mistralai/mistralai@2.2.1" "exactly pinned"; do
    if ! grep -Fq "$expected" "$CHANGELOG"; then
      record_failure "$label" "CHANGELOG.md missing $expected"
      return
    fi
  done

  PASS=$((PASS + 1))
}

run_audit_passes_high_threshold
run_high_and_critical_advisories_block_update
run_audit_uses_workspace_lockfile
run_exact_runtime_dependency
run_semver_ranges_rejected
run_not_dev_dependency
run_frozen_install_ignore_scripts
run_install_lifecycle_scripts_block_update
run_publish_only_scripts_allowed
run_mistral_package_license
run_transitive_licenses_allowlisted
run_non_allowlisted_license_blocks_update
run_license_verification_uses_ci_gate
run_lockfile_records_exact_version
run_manifest_without_lockfile_rejected
run_changelog_records_dependency_addition

if [ "$FAIL" -ne 0 ]; then
  printf 'mistral-sdk-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'mistral-sdk-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
