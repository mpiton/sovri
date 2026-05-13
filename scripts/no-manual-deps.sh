#!/usr/bin/env bash
# Reject manual edits to package.json without a synced pnpm-lock.yaml.
# Forces use of `pnpm add`, `pnpm update`, `pnpm remove`.
# Invoked at pre-commit via lefthook.yml.
set -euo pipefail

STAGED=$(git diff --cached --name-only)
[ -z "$STAGED" ] && exit 0

# If any package.json is staged, require pnpm-lock.yaml staged too whenever any
# of the four dependency blocks (`dependencies`, `devDependencies`,
# `peerDependencies`, `optionalDependencies`) differ between HEAD and the index.
# Edits to other fields (`scripts`, `name`, `version`, ...) pass through.
if echo "$STAGED" | grep -qE '(^|/)package\.json$'; then
  PKG_DEP_CHANGED=$(node -e '
    const cp = require("child_process");
    const files = cp.execFileSync("git", ["diff", "--cached", "-z", "--name-only"], { encoding: "utf8" })
      .split("\0").filter(f => f === "package.json" || f.endsWith("/package.json"));
    // git show failure (file absent from ref — legitimate for new files or
    // deletions) yields empty deps. JSON.parse failure bubbles up so the
    // outer command substitution falls back to fail-closed "yes".
    const readDeps = (ref, file) => {
      let raw;
      try {
        raw = cp.execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        return { dependencies: {}, devDependencies: {}, peerDependencies: {}, optionalDependencies: {} };
      }
      const pkg = JSON.parse(raw);
      return {
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {},
        peerDependencies: pkg.peerDependencies || {},
        optionalDependencies: pkg.optionalDependencies || {},
      };
    };
    const canon = (deps) => JSON.stringify(Object.fromEntries(
      Object.entries(deps).sort().map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort())])
    ));
    let changed = false;
    for (const file of files) {
      const head = canon(readDeps("HEAD", file));
      const idx  = canon(readDeps("", file));
      if (head !== idx) { changed = true; break; }
    }
    process.stdout.write(changed ? "yes" : "no");
  ' 2>/dev/null || echo "yes")

  case "$PKG_DEP_CHANGED" in
    yes|"")
      # Empty output is treated as fail-closed: a future stray write to the
      # node helper's stdout must not silently disable the guard.
      # pnpm workspaces use a single root lockfile (ADR-002); nested
      # `pnpm-lock.yaml` files are not valid lockfile updates and must not
      # satisfy this check. A staged deletion (`git rm pnpm-lock.yaml`)
      # also fails — the file must remain in the index after the commit
      # for `pnpm install --frozen-lockfile` to keep working in CI.
      if ! printf '%s\n' "$STAGED" | grep -qx 'pnpm-lock\.yaml' \
         || ! git cat-file -e :pnpm-lock.yaml 2>/dev/null; then
        echo "BLOCKED: package.json dependency block changed without an updated pnpm-lock.yaml."
        echo ""
        echo "Correct procedure:"
        echo "  pnpm add <package>            # runtime dependency"
        echo "  pnpm add -D <package>         # devDependency"
        echo "  pnpm update <package>         # bump existing dep"
        echo "  pnpm remove <package>         # delete a dep"
        echo ""
        echo "These update pnpm-lock.yaml automatically. Stage both files together."
        echo "npm install / yarn add / bun add forbidden — pnpm only."
        exit 1
      fi
      ;;
    no)
      ;;
    *)
      echo "BLOCKED: dependency-change guard returned unexpected value: '$PKG_DEP_CHANGED'" >&2
      exit 1
      ;;
  esac

  # Reject npm/yarn/bun lock files staged alongside package.json edits.
  # Sovri uses pnpm exclusively (ADR-002).
  if echo "$STAGED" | grep -qE '(^|/)(package-lock\.json|yarn\.lock|bun\.lockb)$'; then
    echo "BLOCKED: package-lock.json, yarn.lock, or bun.lockb detected."
    echo "Sovri uses pnpm exclusively. Remove this lock file and use pnpm-lock.yaml."
    exit 1
  fi
fi

exit 0
