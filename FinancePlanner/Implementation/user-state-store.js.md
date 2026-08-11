---
type: file
domain: data
status: implemented
---

# user-state-store.js

- **Owns:** encrypted, versioned finance-vault persistence — read/write to [[user_finance_state (table)]], [[Optimistic Concurrency Version Check]] (`SELECT ... FOR UPDATE`)
- **Called by:** [[finance-router.js]]
- **Encryption:** [[AES-256-GCM]] via `crypto-store.js` helpers

Related: [[Implementation Index]] · [[user_finance_state (table)]] · [[Optimistic Concurrency Version Check]]
