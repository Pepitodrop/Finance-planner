---
type: feature
domain: data
status: implemented
verification: code-reviewed-not-deployed
---

# Empty Production Data

Finance Planner's production financial default is deliberately empty: zero accounts, zero transactions, zero goals, and no implicit subscriptions. `src/data.ts` no longer carries the historic German starter dataset.

Authentication identity is separate financial state. `auth_store` remains because the application still needs the user's login identity, display name and passkeys; preserving it is what allows personalized greetings such as the user's name after a finance-data cleanup.

Acceptance/screenshot fixture data and the explicit GnuCOBOL test seed are testing facilities only. They are never selected as a normal account's initial state.

The operator cleanup tool removes cloud finance/provider rows while preserving authentication and system-control tables. A non-empty encrypted browser vault must also be reset/removed deliberately before server cleanup if the goal is to prevent that device from synchronizing old finance data back to the server.

Related: [[Data and Persistence]] · [[Test Data Seeding]] · [[Logout]] · [[Vault Encryption]]
