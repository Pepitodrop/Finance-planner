---
type: security
domain: security
status: implemented
---

# Password Hashing

- **Algorithm:** [[scrypt]], `N=16384, r=8, p=1`, 64-byte derived key, random 16-byte salt, `format$salt$hash` encoding (`scrypt-v1`)
- **Implementation:** [[password-auth.js]]
- **Comparison:** never plain `===` — see [[Timing-Safe Password Verification]]
- **Tests:** `server/test/password-auth.test.js`

Related: [[Security Index]] · [[scrypt]] · [[Registration Flow]]
