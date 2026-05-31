#!/usr/bin/env bash
# Acceptance tests for the pinned OpenAI SDK supply-chain policy.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_JSON="$ROOT/packages/llm-providers/package.json"
LOCKFILE="$ROOT/pnpm-lock.yaml"
CHANGELOG="$ROOT/CHANGELOG.md"
BASE_BRANCH="${ATDD_BASE_BRANCH:-origin/atdd/task-104-add-openai-sdk/integration}"
OPENAI_VERSION="6.39.1"
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

pass() {
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
    "" | ^* | ~* | ">"* | "<"* | "="* | *x* | *X* | *"*"* | *" "*)
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

openai_package_json_path() {
  find "$ROOT/node_modules/.pnpm" -path "*/node_modules/openai/package.json" -print -quit 2>/dev/null
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

run_exact_runtime_dependency() {
  local label="llm-providers declares openai as an exact runtime dependency"
  local runtime_version dev_version
  runtime_version="$(json_field "$PACKAGE_JSON" dependencies openai)"
  dev_version="$(json_field "$PACKAGE_JSON" devDependencies openai)"

  # Given the selected OpenAI SDK version from the npm registry is "6.39.1"
  # And the package under test is "packages/llm-providers"
  # When the dependency update is inspected
  # Then "packages/llm-providers/package.json" contains "openai" in "dependencies" with version "6.39.1"
  if [ "$runtime_version" != "$OPENAI_VERSION" ]; then
    record_failure "$label" "expected dependencies.openai $OPENAI_VERSION, got ${runtime_version:-<missing>}"
    return
  fi

  if ! is_exact_dependency_version "$runtime_version"; then
    record_failure "$label" "version is not exact: $runtime_version"
    return
  fi

  if [ -n "$dev_version" ]; then
    record_failure "$label" "devDependencies.openai must be absent"
    return
  fi

  pass
}

run_no_other_manifest_declares_openai() {
  local label="no other workspace package manifest declares openai"
  local manifest

  # And no other workspace package manifest declares "openai"
  for manifest in "$ROOT/package.json" "$ROOT"/apps/*/package.json "$ROOT"/packages/*/package.json; do
    if [ "$manifest" = "$PACKAGE_JSON" ]; then
      continue
    fi

    if [ "$(json_field "$manifest" dependencies openai)" != "" ]; then
      record_failure "$label" "$manifest declares dependencies.openai"
      return
    fi
    if [ "$(json_field "$manifest" devDependencies openai)" != "" ]; then
      record_failure "$label" "$manifest declares devDependencies.openai"
      return
    fi
  done

  pass
}

run_lockfile_records_openai() {
  local label="pnpm lockfile records openai for llm-providers"

  # And "pnpm-lock.yaml" records the "packages/llm-providers" importer for "openai" with specifier "6.39.1"
  for expected in "openai:" "specifier: $OPENAI_VERSION" "openai@$OPENAI_VERSION"; do
    if ! grep -Fq "$expected" "$LOCKFILE"; then
      record_failure "$label" "pnpm-lock.yaml missing $expected"
      return
    fi
  done

  pass
}

run_install_ignore_scripts() {
  local label="frozen install succeeds with lifecycle scripts disabled"

  # And "pnpm install --frozen-lockfile --ignore-scripts" exits 0
  if ! (cd "$ROOT" && pnpm install --frozen-lockfile --ignore-scripts >/dev/null); then
    record_failure "$label" "pnpm install --frozen-lockfile --ignore-scripts failed"
    return
  fi

  pass
}

run_openai_has_no_install_lifecycle() {
  local label="OpenAI SDK has no install lifecycle scripts"
  local package_json_path
  package_json_path="$(openai_package_json_path 2>/dev/null)" || {
    record_failure "$label" "openai/package.json could not be resolved from packages/llm-providers"
    return
  }

  # And the OpenAI SDK dependency tree has no "preinstall", "install", or "postinstall" lifecycle script
  if has_install_lifecycle_script "$package_json_path"; then
    record_failure "$label" "openai@$OPENAI_VERSION declares an install lifecycle script"
    return
  fi

  pass
}

run_audit_high_threshold() {
  local label="pnpm audit stays green at the high threshold"

  # And "pnpm audit --audit-level=high" exits 0
  if ! (cd "$ROOT" && pnpm audit --audit-level=high --ignore-registry-errors >/dev/null); then
    record_failure "$label" "pnpm audit --audit-level=high failed"
    return
  fi

  pass
}

run_dedupe_check() {
  local label="pnpm dedupe check stays green"

  # And "pnpm dedupe --check" exits 0
  if ! (cd "$ROOT" && pnpm dedupe --check >/dev/null); then
    record_failure "$label" "pnpm dedupe --check failed"
    return
  fi

  pass
}

run_license_evidence() {
  local label="license evidence records openai as Apache-2.0"
  local license
  license="$(license_for_package openai)"

  # And the license evidence records "openai@6.39.1" as "Apache-2.0"
  if [ "$license" != "Apache-2.0" ]; then
    record_failure "$label" "expected Apache-2.0, got ${license:-<missing>}"
    return
  fi

  pass
}

run_changelog_entry() {
  local label="changelog records the pinned dependency addition"

  # And "CHANGELOG.md" records the pinned dependency addition under "[Unreleased]" "Added"
  for expected in "## [Unreleased]" "### Added" "openai@$OPENAI_VERSION" "exactly pinned"; do
    if ! grep -Fq "$expected" "$CHANGELOG"; then
      record_failure "$label" "CHANGELOG.md missing $expected"
      return
    fi
  done

  pass
}

run_no_adapter_wiring_changes() {
  local label="no OpenAI adapter or wiring code changes"
  local forbidden_path changed_files
  changed_files="$(cd "$ROOT" && git diff --name-only "$BASE_BRANCH" --)"

  # And no OpenAI adapter, OpenAI-compatible adapter, provider factory, config parser, or community-bot provider wiring file changes
  for forbidden_path in \
    "packages/llm-providers/src/providers/OpenAIProvider.ts" \
    "packages/llm-providers/src/providers/OpenAICompatibleProvider.ts" \
    "packages/llm-providers/src/factory.ts" \
    "packages/config/src/schema.ts" \
    "apps/community-bot/src/runtime-env.ts"; do
    if printf "%s\n" "$changed_files" | grep -Fxq "$forbidden_path"; then
      record_failure "$label" "$forbidden_path changed in dependency-only task"
      return
    fi
  done

  pass
}

run_exact_runtime_dependency
run_no_other_manifest_declares_openai
run_lockfile_records_openai
run_install_ignore_scripts
run_openai_has_no_install_lifecycle
run_audit_high_threshold
run_dedupe_check
run_license_evidence
run_changelog_entry
run_no_adapter_wiring_changes

if [ "$FAIL" -ne 0 ]; then
  printf 'openai-sdk-policy tests: %s passed, %s failed\n%s\n' "$PASS" "$FAIL" "$FAILURES" >&2
  exit 1
fi

printf 'openai-sdk-policy tests: %s passed, %s failed\n' "$PASS" "$FAIL"
