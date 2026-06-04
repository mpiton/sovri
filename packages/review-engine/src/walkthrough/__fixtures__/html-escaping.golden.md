## ❌ Request changes

1 finding — 1 major

### Review assessment

Effort: ●●●●● 5/5
Metrics: `1 finding` · `1 file touched` · `1 blocker plus major finding`

Severity distribution:
Total: 1 finding
Bar: █
- 🔴 major: 1 finding

### TL;DR

Found &lt;script&gt;alert(1)&lt;/script&gt; &amp; comments

### Findings

| Severity | Location         | Title                                 | Details                                                       |
| -------- | ---------------- | ------------------------------------- | ------------------------------------------------------------- |
| 🔴       | src/render.ts:12 | Avoid &lt;b&gt;trusted&lt;/b&gt; HTML | Use &lt;strong&gt;escaped&lt;/strong&gt; text &amp; validate. |

### File-by-file

#### src/render.ts

1 finding

- src/render.ts:12 Avoid &lt;b&gt;trusted&lt;/b&gt; HTML

<details>
<summary>Compliance &amp; provenance</summary>

### Compliance & audit

Model: test-provider / test-model
No signed audit trail is attached

#### Avoid &lt;b&gt;trusted&lt;/b&gt; HTML — src/render.ts:12

🔍 Audit Reference: n/a

</details>

---

_Tokens: 900 in / 150 out · Estimated cost: unavailable (test-provider test-model)_
