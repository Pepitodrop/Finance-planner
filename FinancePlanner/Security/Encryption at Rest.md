---
type: security
domain: security
status: implemented
---

# Encryption at Rest

Every persistent store of sensitive data is encrypted before it touches disk: [[user_finance_state (table)]], [[auth_store (table)]], [[connector_connections (table)]] (server, [[AES-256-GCM]]) and the browser-side vault (client, [[Vault Encryption]]).

Related: [[Security Index]] · [[Encryption Boundary (server)]] · [[Vault Encryption]]
