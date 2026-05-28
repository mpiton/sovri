## Sovri review

### TL;DR

Three review findings need attention.

### Findings

#### Blocker

| Severity | Location                  | Title                     | Details                                                   |
| -------- | ------------------------- | ------------------------- | --------------------------------------------------------- |
| Blocker  | src/auth/session.ts:42-45 | Unvalidated session token | The handler accepts a token without signature validation. |

#### Major

| Severity | Location             | Title                      | Details                                       |
| -------- | -------------------- | -------------------------- | --------------------------------------------- |
| Major    | src/api/review.ts:18 | Missing payload null guard | The review payload is read before validation. |

#### Minor

| Severity | Location             | Title             | Details                                   |
| -------- | -------------------- | ----------------- | ----------------------------------------- |
| Minor    | src/api/review.ts:31 | Duplicated branch | The branch repeats an existing condition. |

### File-by-file

#### src/api/review.ts

2 findings

- src/api/review.ts:18 Missing payload null guard
- src/api/review.ts:31 Duplicated branch

#### src/auth/session.ts

1 finding

- src/auth/session.ts:42-45 Unvalidated session token

### Compliance & audit

#### Unvalidated session token — src/auth/session.ts:42-45

🔍 Audit Reference: n/a

#### Missing payload null guard — src/api/review.ts:18

🔍 Audit Reference: n/a

#### Duplicated branch — src/api/review.ts:31

🔍 Audit Reference: n/a

---

_Tokens: 1200 in / 300 out · Estimated cost: unavailable (test-provider test-model)_
