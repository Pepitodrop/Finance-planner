---
type: file
domain: auth
status: implemented
---

# auth-router.js

- **Owns:** Google OAuth start/callback, email/password register/login, WebAuthn passkey register/authenticate options+verify, logout, session check
- **Implements features:** [[Authentication]], [[Google OAuth]], [[WebAuthn Passkeys]]
- **Key logic:** [[Timing-Safe Password Verification]] (`DUMMY_PASSWORD_HASH`), same-account resolution (Google ↔ email/password merge on matching email), [[Logout]] (`revokeSession`)
- **Tests:** [[Authentication Tests]] (`auth-router.test.js`)
- **Security decisions concerning it:** [[Security Decisions]] (user-enumeration, timing, CodeQL alert #1 dismissal)

Related: [[Implementation Index]] · [[Login and Registration]] · [[password-auth.js]]
