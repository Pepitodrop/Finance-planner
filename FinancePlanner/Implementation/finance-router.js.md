---
type: file
domain: finance
status: implemented
---

# finance-router.js

- **Owns:** `GET/POST /api/finance/state` — the finance-state API, returns HTTP 409 on a version mismatch
- **Depends on:** [[user-state-store.js]]
- **Validates:** rejects unknown fields, malformed IDs, invalid dates, non-integer money, duplicate IDs, orphaned transaction→account references, oversized payloads

Related: [[Implementation Index]] · [[HTTP-API Layer]] · [[Vault Conflict Page]]
