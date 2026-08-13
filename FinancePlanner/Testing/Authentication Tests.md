---
type: test
domain: auth
status: implemented
---

# Authentication Tests

- `server/test/auth-router.test.js` — Google OAuth, email/password, passkey option endpoints, session issuance, [[Timing-Safe Password Verification]] and [[Session Revocation]] regression coverage
- `server/test/runtime-security.test.js` — `AUTH_MODE=local` production hard-block
- `src/AuthGate.test.tsx` — client UI

Related: [[Testing and CI Index]] · [[Authentication]] · [[Login and Registration]]
