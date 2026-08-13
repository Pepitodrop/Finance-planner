---
type: flow
domain: provider
status: implemented
---

# Bank Disconnect Flow

[[Connections Page]] → disconnect requested → [[providers.js]] adapter's `disconnect()` invalidates the provider-side consent/requisition where the provider API supports it, and the connector deletes the corresponding row from [[connector_connections (table)]] (`DELETE FROM connector_connections WHERE user_id=$1 AND provider=$2`, [[postgres-store.js]]).

Related: [[Bank Connections]] · [[Connections Page]] · [[postgres-store.js]]
