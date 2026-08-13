---
type: database
domain: data
status: implemented
---

# user_finance_state (table)

- **Migration:** `006_cloud_user_data.sql`
- **Contains:** accounts, transactions, savings goals, behavior graph, assistant memory, secure client prefs — the encrypted finance-vault payload
- **Encryption:** [[AES-256-GCM]], `CONNECTOR_MASTER_KEY`, user ID as AAD
- **Store/repository:** [[user-state-store.js]]
- **API:** `GET/POST /api/finance/state` via [[finance-router.js]]
- **Concurrency:** [[Optimistic Concurrency Version Check]] — `SELECT ... FOR UPDATE` + `expectedVersion` compare-and-swap, HTTP 409 on mismatch
- **Ownership:** every query `WHERE user_id=$1`-scoped — see [[Cross-User Isolation]]
- **Deletion:** cascaded in [[Account Deletion Flow]]
- **Feature/flow:** every page under [[Pages Index]] that reads/writes finance data

Related: [[Data Index]] · [[Data and Persistence]] · [[Vault Conflict Page]]
