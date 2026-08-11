---
type: file
domain: data
status: implemented
---

# postgres-store.js

- **Owns:** [[connector_connections (table)]], [[oauth_nonces (table)]], [[webhook_events (table)]] persistence — single-use nonce consumption (`DELETE ... RETURNING 1`), webhook lease/idempotency

Related: [[Implementation Index]] · [[connector_connections (table)]] · [[oauth_nonces (table)]] · [[webhook_events (table)]]
