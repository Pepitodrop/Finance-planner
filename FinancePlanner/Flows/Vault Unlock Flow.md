---
type: flow
domain: data
status: implemented
---

# Vault Unlock Flow

Authenticated user with an existing vault → [[Vault Unlock]] → device vault password decrypts local cache → `GET /api/finance/state` fetches the server copy → if server version is newer, it replaces the local cache (re-encrypted locally) → [[isLegacyDemoState]] check runs once → if a genuine version conflict exists instead, [[Vault Conflict Page]] is shown rather than silently picking a side.

Related: [[Vault Unlock]] · [[Optimistic Concurrency Version Check]] · [[Legacy-Demo-State Cleanup]]
