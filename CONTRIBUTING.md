# Contributing to Sovri

Thanks for helping improve Sovri. This is the canonical public guide for
day-to-day contribution expectations: how to set up the repo, which checks to
run, how to write commits, and how to open a reviewable pull request.

## Ways to contribute

- Pick up an open GitHub issue or discuss a proposed change before starting larger work.
- Improve tests, documentation, tooling, or examples when you find gaps.
- Keep pull requests focused. Separate unrelated fixes, refactors, and dependency updates.
- Report security issues through the security policy instead of public issues.

## Setup

Sovri is a pnpm monorepo.

Required tools:

- Node.js `>=24.0.0 <25.0.0`
- pnpm `>=10.0.0 <11.0.0`
- Package manager version: `pnpm@10.33.2`

Install dependencies:

```sh
pnpm install --frozen-lockfile
```

## Git hooks

Sovri uses Lefthook for local Git hooks. Hook configuration is delivered by the
tooling track; when your checkout contains `lefthook.yml`, install local hooks
once after cloning and installing dependencies:

```sh
pnpm exec lefthook install
```

The project standard hook manager is Lefthook. Local hooks mirror the required
CI gates where practical, so a clean local commit should predict a clean pull
request.

Never bypass hooks:

- Do not run `git commit --no-verify`.
- Do not run `git push --no-verify`.
- Do not disable hooks through equivalent workarounds.

If a hook or CI gate blocks an emergency fix, coordinate with a maintainer to
fix, split, or revert the blocked change. Hooks and required CI gates must still
pass before merge.

See [ADR-012](docs/adr/012-lefthook-ci-gates.md) for the hook and CI gate policy.

## Development commands

Run the relevant checks before opening a pull request. For code changes, run the
full quality gate unless the change is documentation-only and cannot affect
code.

| Command             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `pnpm build`        | Run all package build tasks with Turborepo.        |
| `pnpm test`         | Run all test tasks with Turborepo.                 |
| `pnpm lint`         | Run `oxlint` with zero warnings allowed.           |
| `pnpm format:check` | Check formatting with `oxfmt`.                     |
| `pnpm typecheck`    | Run all TypeScript typecheck tasks with Turborepo. |
| `pnpm knip`         | Check for unused files, exports, and dependencies. |

Linting and formatting are handled by `oxlint` and `oxfmt`; do not introduce
ESLint, Prettier, Biome, or project-local alternatives. See
[ADR-011](docs/adr/011-oxlint-oxfmt.md).

Configuration changes that affect `.sovri.yml` must update the public
[`.sovri.yml` reference](docs/sovri-yml-reference.md) in the same pull request.

## Dependencies

Do not edit `package.json` dependency blocks by hand.

Use pnpm so `package.json` and `pnpm-lock.yaml` stay consistent:

```sh
pnpm add <package>
pnpm update <package>
pnpm remove <package>
```

Use the workspace-aware pnpm flags when changing dependencies for a specific
package or workspace.

Dependency pull requests must keep exact versions and the lockfile in sync,
verify license compatibility, and run `pnpm audit --audit-level=high` before
review.

## Commit conventions

Use Conventional Commits:

```text
<type>(<scope>): <summary>
```

Allowed types:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`
- `ci`
- `perf`
- `build`

Allowed scopes:

- `core`
- `review-engine`
- `llm-providers`
- `config`
- `observability`
- `bot`
- `cloud`
- `ci`
- `hooks`
- `docs`
- `deps`
- `release`

Examples:

```text
feat(review-engine): add inline finding aggregation
fix(hooks): align pre-push checks with CI
docs(core): clarify workspace setup
```

## Pull requests

Use the repository pull request template and complete its sections:

- Summary
- Changes
- Related Issues
- Type of Change
- Checklist
- Screenshots, when applicable

Link related issues with `Closes #123`, `Fixes #123`, or another clear
reference. Before requesting review, confirm that tests and quality gates
relevant to the change pass locally, update documentation when behavior changes,
and include screenshots for visible UI changes.

## Project rules

- Keep public documentation self-contained and safe to read without private context.
- Do not reference private planning notes or internal-only workflow files from public docs.
- Keep generated or lockfile changes tied to the command that produced them.
- Do not introduce alternate package managers or lockfiles.
- Do not use inline lint disables; fix the issue or propose a repo-level
  configuration change with justification.

## License, conduct, and security

Sovri is licensed under [Apache-2.0](LICENSE).

Contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md)
and keep discussion focused on the technical work.

For vulnerabilities or sensitive security concerns, follow the repository
security policy in [.github/SECURITY.md](.github/SECURITY.md) instead of opening
a public issue.
