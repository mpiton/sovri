🔴 🔒 Security
**Escape user-supplied HTML**

The renderer must keep user-controlled HTML inert before posting review output.

🔍 Audit Reference: SOVRI-AC-AB12-CD34

```suggestion
const safeHtml = escapeHtml(input);
```

<!-- sovri-finding-id: 7c82fe791bbeffc5 -->
