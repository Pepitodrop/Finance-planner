---
type: test
domain: security
status: implemented
---

# Password Security Tests

- `server/test/password-auth.test.js` — [[scrypt]] hashing/verification primitives
- `server/test/test-password-auth.test.js` — test-account scoped password path
- `scripts/verify-test-password-leakage.mjs` — independently proves no dedicated test-password UI copy ships in a normal production bundle (part of the `npm test` chain)

Related: [[Testing and CI Index]] · [[Password Hashing]] · [[password-auth.js]]
