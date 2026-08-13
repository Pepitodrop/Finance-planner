---
type: database
domain: data
status: implemented
---

# user_session_revocations (table)

- **Migration:** `008_session_revocations.sql`
- **Contains:** per-user session-revocation markers, refreshed roughly every 30s
- **Store/repository:** [[session-revocation.js]] (`SessionRevocationRegistry`)
- **Semantics:** revocation is per-**user**, not per-token — deliberate, see [[Logout Flow]]/[[Session Revocation]]
- **Retention:** [[retention.js]] purges stale revocation rows
- **Deletion:** wired into both [[Logout Flow]] and [[Account Deletion Flow]]

Related: [[Data Index]] · [[Session Revocation]] · [[session-revocation.js]]
