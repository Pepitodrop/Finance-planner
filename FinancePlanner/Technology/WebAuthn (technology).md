---
type: technology
domain: security
status: implemented
---

# WebAuthn (technology)

- **Where used:** [[WebAuthn Passkeys]] feature — `@simplewebauthn/server` (backend, [[auth-router.js]]) + `@simplewebauthn/browser` (client, [[AuthGate.tsx]])
- **Why:** standards-based, phishing-resistant authentication; not provider-dependent in the API sense, but device/browser-dependent for real verification
- **Configuration:** `residentKey: 'required'`, `userVerification: 'required'`
- **Tests:** `server/test/passkey-authenticator-compatibility.test.js` (unit-level compatibility only)
- **Verification state:** implemented / **no real-authenticator hardware runtime evidence** — `docs/issue-105-live-verification.md` requires manual multi-platform testing

Related: [[Technology Index]] · [[WebAuthn Passkeys]] · [[Passkey Enrolment Flow]]
