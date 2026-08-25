---
type: file
domain: auth
status: implemented
---

# AuthGate.tsx

- **Owns:** [[Login and Registration]] pre-auth screen, [[Passkey Enrolment Banner]] post-login
- **PR #131 redesign:** never shows a pre-auth passkey button — only Google + email/password
- **`logout()` (updated 2026-08-25):** calls `clearPendingConnectorAttempt()` ([[providerReturnBridge.ts]]) after revoking the session, so a stale bank-connection popup attempt bound to the browser tab can't be picked up by a different user logging into the same tab. See [[Logout]].

Related: [[Implementation Index]] · [[Login and Registration]] · [[Passkey Enrolment Banner]] · [[Logout]] · [[providerReturnBridge.ts]]
