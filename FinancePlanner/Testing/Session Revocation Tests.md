---
type: test
domain: security
status: implemented
---

# Session Revocation Tests

- `server/test/auth-router.test.js` — logout-revokes-server-side regression coverage
- **Live two-browser-context test (`/qa`, 2026-08-11):** registered in context A, logged in as the same user in context B, logged out from A — B flipped from `authenticated: true` to `authenticated: false` immediately. Confirms per-user (not per-token) revocation semantics.

Related: [[Testing and CI Index]] · [[Session Revocation]] · [[Logout Flow]]
