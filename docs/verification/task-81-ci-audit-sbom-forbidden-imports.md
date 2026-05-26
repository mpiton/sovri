# Task 81 Verification: CI Audit, SBOM, and Forbidden Gates

## Scope

This verification confirms that the CI and supply-chain gates stay green after
adding `@mistralai/mistralai@2.2.1` as an exactly pinned runtime dependency.

## Results

| Gate              | Command                                                  | Result                                 |
| ----------------- | -------------------------------------------------------- | -------------------------------------- |
| Frozen install    | `pnpm install --frozen-lockfile --ignore-scripts`        | Passed                                 |
| Build             | `pnpm exec turbo build`                                  | Passed                                 |
| Coverage          | `pnpm exec vitest run --coverage`                        | Passed: 85 files, 1509 tests           |
| Audit             | `pnpm audit --audit-level=high --ignore-registry-errors` | Passed: no high or critical advisories |
| Dedupe            | `pnpm dedupe --check`                                    | Passed                                 |
| Forbidden imports | `./scripts/check-boundary.sh --all`                      | Passed                                 |
| Forbidden tools   | `./scripts/no-forbidden-tools.sh --all`                  | Passed                                 |

## SBOM Evidence

The workspace does not provide a `syft` binary through `pnpm exec`; the command
`pnpm exec syft scan dir:. -o cyclonedx-json=sbom.json` exits with
`Command "syft" not found`.

SBOM generation was verified with the official Anchore Syft container instead:

```sh
docker run --rm -v "$PWD:/work" anchore/syft:latest dir:/work \
  -o cyclonedx-json=/work/sbom.json
```

The generated CycloneDX SBOM contains the expected Mistral SDK component:

```json
{
  "name": "@mistralai/mistralai",
  "version": "2.2.1",
  "type": "library",
  "purl": "pkg:npm/%40mistralai/mistralai@2.2.1"
}
```

The pulled Syft image digest for this verification was
`sha256:86fde6445b483d902fe011dd9f68c4987dd94e07da1e9edc004e3c2422650de6`.

## Notes

No runtime code changes were required. The only gap found is documentation or
tooling drift around the local SBOM command: Syft is treated as an external
tool, while the historical local command assumes it is available through
`pnpm exec`.
