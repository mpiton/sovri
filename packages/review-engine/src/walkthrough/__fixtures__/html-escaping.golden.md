## Sovri review

### TL;DR

Found &lt;script&gt;alert(1)&lt;/script&gt; &amp; comments

### Findings

#### Major

| Severity | Location         | Title                                 | Details                                                       |
| -------- | ---------------- | ------------------------------------- | ------------------------------------------------------------- |
| Major    | src/render.ts:12 | Avoid &lt;b&gt;trusted&lt;/b&gt; HTML | Use &lt;strong&gt;escaped&lt;/strong&gt; text &amp; validate. |

### File-by-file

#### src/render.ts

1 finding

- src/render.ts:12 Avoid &lt;b&gt;trusted&lt;/b&gt; HTML
