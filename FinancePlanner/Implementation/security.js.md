---
type: file
domain: security
status: implemented
---

# security.js

- **Owns:** `issueState`/`verifyState` (OAuth CSRF/replay protection), `createSession`, `verifySessionClaims`, `bearerToken`
- **Used by:** [[server.js]], [[auth-router.js]] for every provider callback and session check

Related: [[Implementation Index]] · [[OAuth State and Nonce]] · [[Session Cookie]]
