---
type: security
domain: security
status: implemented
---

# Session Revocation

Postgres-backed registry ([[session-revocation.js]], [[user_session_revocations (table)]]), refreshed ~30s. Revocation is **per-user**, not per-token — a deliberate tradeoff.

- **Wired into:** [[Logout Flow]] (fixed 2026-08-10 — previously only cleared the browser cookie) and [[Account Deletion Flow]] (was already wired)
- **Consequence, independently re-verified with two browser contexts during `/qa`:** logging out on one device deauthenticates other sessions for the same user — surprising UX, not a bug

Related: [[Security Index]] · [[Logout Flow]] · [[user_session_revocations (table)]] · [[Security Decisions]]
