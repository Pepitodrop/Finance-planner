---
type: file
domain: security
status: implemented
---

# session-revocation.js

- **Owns:** `SessionRevocationRegistry` — HMAC session-key derivation, Postgres-backed revocation, ~30s refresh
- **Storage:** [[user_session_revocations (table)]]
- **Used by:** [[Logout Flow]], [[Account Deletion Flow]], every authenticated session check
- **Tests:** [[Session Revocation Tests]]

Related: [[Implementation Index]] · [[Session Revocation]] · [[Session Cookie]]
