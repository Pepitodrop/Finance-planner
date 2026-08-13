---
type: language
domain: data
status: implemented
---

# SQL

- **Where used:** `server/migrations/*.sql` (forward) and `server/migrations/down/*.sql` (rollback), all store modules ([[postgres-store.js]], [[user-state-store.js]], [[auth-store.js]] etc.) via parameterized queries
- **Why:** [[PostgreSQL]] is the canonical cross-device store — see [[Data and Persistence]]
- **Subsystems depending on it:** [[Persistence System]], every table in [[Data Index]]
- **Security:** all queries observed during this graph pass use parameterized placeholders (`$1`, `$2`...), not string interpolation — consistent with avoiding SQL injection, not independently re-audited exhaustively this pass

Related: [[Technology Index]] · [[PostgreSQL]] · [[Data Index]]
