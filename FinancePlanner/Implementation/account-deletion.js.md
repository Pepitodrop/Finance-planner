---
type: file
domain: data
status: implemented
---

# account-deletion.js

- **Owns:** the single atomic transaction cascading `DELETE FROM` [[connector_connections (table)]], [[oauth_nonces (table)]], [[user_finance_state (table)]], [[user_budget_learning_profiles (table)]] scoped by `user_id`
- **Reuses:** the [[Session Revocation]] path already wired for logout

Related: [[Implementation Index]] · [[Account Deletion Flow]] · [[Cross-User Isolation]]
