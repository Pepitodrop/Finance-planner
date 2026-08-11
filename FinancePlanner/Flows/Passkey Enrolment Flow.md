---
type: flow
domain: auth
status: implemented
---

# Passkey Enrolment Flow

Post-login only. [[Dashboard Page]] (or any page) → [[Passkey Enrolment Banner]] shown → `POST /api/auth/passkeys/register/options` (server issues challenge) → `@simplewebauthn/browser` ceremony on-device → `POST /api/auth/passkeys/register/verify` → passkey stored in [[auth_store (table)]] → `user.passkeyCount` incremented, shown on [[Account Page]].

- **Security:** `residentKey: 'required'`, `userVerification: 'required'`
- **Verification state:** implemented, unit-tested (`server/test/passkey-authenticator-compatibility.test.js`) — **no real-authenticator runtime evidence**; [[Test Enrollment Page]] exists specifically so CI can exercise this without hardware

Related: [[WebAuthn Passkeys]] · [[Passkey Enrolment Banner]]
