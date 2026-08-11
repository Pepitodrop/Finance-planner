---
type: file
domain: auth
status: implemented
---

# auth-store.js

- **Owns:** [[auth_store (table)]] persistence — Google profile, passkeys, WebAuthn challenges, email/password records
- **Encryption:** `keyFromSecret()` derives a fixed AES-256-GCM key from `AUTH_MASTER_KEY`
- **CodeQL:** the dismissed alert #1 (`js/insufficient-password-hash`) targeted this file's `keyFromSecret()` — confirmed false positive, see [[CodeQL]]

Related: [[Implementation Index]] · [[auth_store (table)]] · [[Security Decisions]]
