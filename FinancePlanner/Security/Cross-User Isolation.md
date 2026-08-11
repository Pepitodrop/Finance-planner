---
type: security
domain: security
status: implemented
---

# Cross-User Isolation

Every finance-state/auth/connector query is `user_id`-scoped (`WHERE user_id=$1`) — no cross-user query pattern found across [[user-state-store.js]], [[postgres-store.js]], [[account-deletion.js]] during repeated code review across `/cso`, `/qa`, and `/ship` phases.

- **Live-tested (`/cso`):** two-synthetic-user horizontal-authorization test, airtight

Related: [[Security Index]] · [[user_finance_state (table)]] · [[Account Deletion Flow]] · [[Security Decisions]]
