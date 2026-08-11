---
type: page
domain: auth
status: implemented
---

# Passkey Enrolment Banner / Recommendation (page)

Optional, dismissible, post-login-only prompt to register a passkey. Never a pre-auth choice.

- **Component:** [[AuthGate.tsx]] (`.passkey-enrolment`), rendered through the `runtime-surfaces` exclusivity system
- **Coexistence rule:** must never obstruct [[Vault Setup]]'s submit button — fixed via a structural CSS change (`body:has(.vault-screen) .passkey-enrolment { position: static; }`), not by hiding the banner (a real regression found and fixed in PR #131, see [[Debugging Learnings]])
- **APIs called:** `POST /api/auth/passkeys/register/options`, `/register/verify`
- **Backend service:** [[auth-router.js]] via `@simplewebauthn/server`
- **Security control:** `residentKey: 'required'`, `userVerification: 'required'`
- **Related tests:** `scripts/auth-security-production-acceptance.mjs` `obstructsVaultSubmit` per-viewport assertion ([[Production Browser Acceptance]])
- **Verification state:** implemented, unit-tested; **no real-authenticator runtime evidence** — see [[WebAuthn Passkeys]]

Related: [[Authentication]] · [[Vault Setup]] · [[Passkey Enrolment Flow]]
