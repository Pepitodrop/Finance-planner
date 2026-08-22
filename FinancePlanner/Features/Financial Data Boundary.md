---
type: feature
domain: data
status: implemented
---

# Financial Data Boundary

For cleanup purposes, financial/provider data is the state in `user_finance_state`, `user_budget_learning_profiles`, `connector_connections`, `oauth_nonces`, and `webhook_events`. Authentication identity, passkeys, session revocations, rate-limit windows and migration history are system/security state and intentionally survive a finance-data cleanup.

Related: [[Finance Data Cleanup]] · [[Data and Persistence]] · [[Authentication]]
