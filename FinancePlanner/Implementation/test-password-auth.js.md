---
type: file
domain: auth
status: implemented
---

# test-password-auth.js

- **Owns:** scrypt password auth gated by `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD_HASH`, only for `test:`-prefixed user IDs — the configured test account goes through the same general login endpoint/UI as any real user, not a separate surface

Related: [[Implementation Index]] · [[Test Enrollment Page]] · [[password-auth.js]]
