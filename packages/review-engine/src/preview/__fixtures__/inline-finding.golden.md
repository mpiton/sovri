🔴 🔒 Security
**Escape user-supplied HTML**

**Problem:** The renderer must keep user-controlled HTML inert before posting review output.

**Fix:** Apply the fix for escape user-supplied html: change the code so the problem no longer occurs.

🔍 Audit Reference: SOVRI-AC-AB12-CD34

```suggestion
const safeHtml = escapeHtml(input);
```

<!-- sovri-finding-id: 7c82fe791bbeffc5 -->
