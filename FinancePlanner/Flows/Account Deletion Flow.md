---
type: flow
domain: data
status: implemented
---

# Account Deletion Flow

[[Account Page]] → deletion confirmed → [[account-deletion.js]] runs a single atomic transaction cascading `DELETE FROM` [[connector_connections (table)]], [[oauth_nonces (table)]], [[user_finance_state (table)]], [[user_budget_learning_profiles (table)]] (and related rows) scoped by `user_id` → [[Session Revocation]] path also wired (same registry as logout).

- **Security:** every delete is `user_id`-scoped — no cross-user deletion possible
- **Known gap:** deletion is complete; formal documented data-export-before-deletion workflow is not — see [[Known Issues and Limitations]]

Related: [[account-deletion.js]] · [[Cross-User Isolation]] · [[Account Page]]
