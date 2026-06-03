## ❌ Request changes

1 finding — 1 major

### TL;DR

The PR has actionable review findings.

### Findings

| Severity | Location             | Title                      | Details                                                                                          |
| -------- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| 🔴       | src/api/review.ts:18 | Missing payload null guard | The review payload is read before validation. Add a schema parse before accessing nested fields. |

### File-by-file

#### src/api/review.ts

1 finding

- src/api/review.ts:18 Missing payload null guard

### Compliance & audit

#### Missing payload null guard — src/api/review.ts:18

🔍 Audit Reference: n/a

---

_Tokens: 1100 in / 260 out · Estimated cost: unavailable (test-provider test-model)_