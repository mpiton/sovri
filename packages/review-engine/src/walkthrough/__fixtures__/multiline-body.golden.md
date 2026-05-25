## Sovri review

### TL;DR

The PR has actionable review findings.

### Findings

#### Major

| Severity | Location             | Title                      | Details                                                                                          |
| -------- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Major    | src/api/review.ts:18 | Missing payload null guard | The review payload is read before validation. Add a schema parse before accessing nested fields. |

### File-by-file

#### src/api/review.ts

1 finding

- src/api/review.ts:18 Missing payload null guard

---

_Tokens: 1100 in / 260 out · Estimated cost: unavailable (test-provider test-model)_
