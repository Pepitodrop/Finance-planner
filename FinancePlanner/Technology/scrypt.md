---
type: technology
domain: security
status: implemented
---

# scrypt

- **Where used:** [[password-auth.js]] — account (login) password hashing, not vault/backup encryption
- **Configuration:** `N=16384, r=8, p=1`, 64-byte derived key, random 16-byte salt, `format$salt$hash` encoding (`scrypt-v1`)
- **Comparison:** `crypto.timingSafeEqual` — see [[Timing-Safe Password Verification]]

Related: [[Technology Index]] · [[Password Hashing]] · [[password-auth.js]]
