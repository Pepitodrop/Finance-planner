---
type: provider
domain: auth
status: unverified
---

# WebAuthn / Passkeys (provider)

- **Implemented:** yes — `@simplewebauthn/server` + `@simplewebauthn/browser`, [[auth-router.js]], [[AuthGate.tsx]]
- **Configured:** yes (no external API — device/browser-dependent, not a hosted provider)
- **Mocked:** no
- **UI:** [[Passkey Enrolment Banner]], [[Account Page]] (status line), [[Test Enrollment Page]] (non-production enrollment path)
- **Security controls:** `residentKey: 'required'`, `userVerification: 'required'`
- **Test coverage:** `server/test/passkey-authenticator-compatibility.test.js` — unit-level only, no real hardware
- **Live verified:** unit-level compatibility coverage only · **Provider/device verified:** no — no real-authenticator hardware runtime evidence · **Production verified:** no
- **Known blocker:** `docs/issue-105-live-verification.md` requires manual multi-platform (Android/iOS/Windows over HTTPS) hardware verification

Related: [[Providers Index]] · [[WebAuthn (technology)]] · [[Passkey Enrolment Flow]]
