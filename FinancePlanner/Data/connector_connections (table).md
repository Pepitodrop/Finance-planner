---
type: database
domain: data
status: implemented
---

# connector_connections (table)

- **Migration:** `001_connector_store.sql`
- **Contains:** bank/PayPal provider credentials and connection metadata (AES-256-GCM encrypted provider payload)
- **Store/repository:** [[postgres-store.js]]
- **Deletion:** `DELETE FROM connector_connections WHERE user_id=$1 AND provider=$2` on disconnect ([[Bank Disconnect Flow]]); full-user cascade in [[Account Deletion Flow]]
- **Ownership:** `user_id`-scoped

Related: [[Data Index]] · [[Bank Connections]] · [[PayPal]] · [[Providers Index]]
