## ❌ Request changes

4 findings — 1 major, 2 minor, 1 info

### Review assessment

Effort: ●●●●● 5/5
Metrics: `4 findings` · `3 files touched` · `1 blocker plus major finding`

Severity distribution:
Total: 4 findings
Bar: ████
- 🔴 major: 1 finding
- 🟡 minor: 2 findings
- ℹ️ info: 1 finding

### TL;DR

Preview summary fixture for example/review-target#42.

### Findings

| Severity | Location              | Title                             | Details                                                                                              |
| -------- | --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 🔴       | src/render.ts:18      | Escape user-supplied HTML         | The renderer must keep user-controlled HTML inert before posting review output.                      |
| 🟡       | src/render.test.ts:22 | Cover empty findings in snapshots | The preview catalog needs an assertion for empty review output before changing the summary template. |
| 🟡       | src/render.ts:33-36   | Extract markdown section builder  | The summary renderer repeats section assembly logic that should stay centralized.                    |
| ℹ️       | README.md:12          | Document preview harness usage    | The local-only preview workflow should be discoverable for maintainers.                              |

### File-by-file

#### README.md

1 finding

- README.md:12 Document preview harness usage

#### src/render.test.ts

1 finding

- src/render.test.ts:22 Cover empty findings in snapshots

#### src/render.ts

2 findings

- src/render.ts:18 Escape user-supplied HTML
- src/render.ts:33-36 Extract markdown section builder

<details>
<summary>Compliance &amp; provenance</summary>

### Compliance & audit

Model: test-provider / test-model
No signed audit trail is attached

#### Escape user-supplied HTML — src/render.ts:18

🔍 Audit Reference: SOVRI-AC-AB12-CD34

#### Cover empty findings in snapshots — src/render.test.ts:22

🔍 Audit Reference: n/a

#### Extract markdown section builder — src/render.ts:33-36

🔍 Audit Reference: n/a

#### Document preview harness usage — README.md:12

🔍 Audit Reference: n/a

</details>
