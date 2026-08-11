---
type: file
domain: auth
status: implemented
---

# password-auth.js

- **Owns:** [[scrypt]]-based [[Password Hashing]] (`N=16384, r=8, p=1`, `scrypt-v1` format), `verifyPassword()`
- **Called by:** [[auth-router.js]]
- **Tests:** [[Password Security Tests]] (`password-auth.test.js`)

Related: [[Implementation Index]] · [[Password Hashing]] · [[scrypt]]
