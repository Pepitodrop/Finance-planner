---
type: database
domain: data
status: implemented
---

# auth_store (table)

- **Contains:** Google profile data, passkey credentials, WebAuthn challenges, email/password account records
- **Encryption:** [[AES-256-GCM]], `AUTH_MASTER_KEY` (legacy fallback to `CONNECTOR_MASTER_KEY`)
- **Store/repository:** `server/src/auth-store.js`
- **CodeQL note:** the historically-dismissed alert #1 (`js/insufficient-password-hash`) targeted this file's `keyFromSecret()` — confirmed false positive, traces to test-fixture constants, not the real production key path ([[Security Decisions]])
- **API:** every endpoint in [[auth-router.js]]
- **Deletion:** cascaded in [[Account Deletion Flow]]

Related: [[Data Index]] · [[Authentication]] · [[Security Decisions]]
