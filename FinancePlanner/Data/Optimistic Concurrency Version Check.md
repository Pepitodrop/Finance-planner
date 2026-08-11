---
type: component
domain: data
status: implemented
---

# Optimistic Concurrency Version Check

Every write to [[user_finance_state (table)]] carries an `expectedVersion`. [[user-state-store.js]] reads the current version under `SELECT ... FOR UPDATE` inside a transaction, compares, and only then applies the conditional `UPDATE`. [[finance-router.js]] surfaces a mismatch as HTTP 409, never a silent overwrite.

- **Decision record:** [[Architecture Decisions]] — "Writes... use optimistic concurrency, not last-write-wins"
- **UI consequence:** [[Vault Conflict Page]]

Related: [[Data Index]] · [[user_finance_state (table)]] · [[Vault Conflict Page]]
