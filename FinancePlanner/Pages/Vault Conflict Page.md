---
type: page
domain: data
status: implemented
---

# Vault Conflict (page)

Explicit UI shown when the server rejects a write because `expectedVersion` no longer matches — a genuine, non-silent conflict, never auto-resolved.

- **Component:** [[VaultConflict.tsx]]
- **Trigger:** HTTP 409 from `POST /api/finance/state`
- **Backend logic:** [[Optimistic Concurrency Version Check]] in [[user-state-store.js]] / [[finance-router.js]]
- **Related tests:** `src/VaultConflict.test.tsx`
- **Known non-bug surprise:** logging out on one device deauthenticates other sessions for the same user (per-user, not per-token, revocation) — can look like a spurious conflict during manual testing; independently re-verified during `/qa`, classified as intentional ([[Session Revocation]])
- **Flow:** appears mid-[[Vault Unlock Flow]] or after an out-of-order concurrent edit

Related: [[Data and Persistence]] · [[Architecture Decisions]]
