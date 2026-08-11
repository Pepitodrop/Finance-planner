---
type: flow
domain: auth
status: implemented
---

# Logout Flow

[[Account Page]] → `POST /api/auth/logout` → [[auth-router.js]] clears the browser cookie **and** calls `revokeSession(userId)` → [[Session Revocation]] registry marks the user's sessions revoked → any other active session for that same user is also invalidated on its next check (per-user, not per-token).

- **Fixed in PR #131 `/cso`:** previously only the cookie was cleared; a captured/stolen token stayed valid until natural TTL. Live-verified before/after.
- **Surprising-but-correct consequence:** logging out on one device deauthenticates other devices for the same account — independently re-confirmed with two browser contexts during `/qa`, not a bug.

Related: [[Session Revocation]] · [[Security Decisions]] · [[Account Page]]
