🟠 Major · 🔒 Security: Escape user-supplied HTML

The renderer must keep user-controlled HTML inert before posting review output.

```suggestion
const safeHtml = escapeHtml(input);
```

🔍 Audit Reference: SOVRI-AC-AB12-CD34

<!-- sovri:finding:test-inline-001 -->
