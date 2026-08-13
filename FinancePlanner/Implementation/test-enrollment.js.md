---
type: file
domain: auth
status: implemented
---

# test-enrollment.js

- **Owns:** time-limited (≤60 min), single-use passkey-enrollment token generation for [[Test Enrollment Page]] — lets CI/QA enroll a passkey for a `test:`-prefixed account without real hardware
- **Explicitly non-production**, paired with `test-account-provisioning.js` and `test-password-auth.js`

Related: [[Implementation Index]] · [[Test Enrollment Page]] · [[WebAuthn Passkeys]]
