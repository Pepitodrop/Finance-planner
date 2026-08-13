---
type: page
domain: auth
status: implemented
---

# Login and Registration (page)

The unauthenticated entry screen. Offers exactly two primary choices — Google and email/password — never a pre-auth passkey button (PR #131 redesign).

- **Component:** [[AuthGate.tsx]]
- **Route:** unauthenticated root (no session cookie / `GET /api/auth/session` returns `authenticated: false`)
- **APIs called:** `POST /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/password/register`, `POST /api/auth/password/login`
- **Backend service:** [[auth-router.js]], [[password-auth.js]]
- **Security controls:** [[Timing-Safe Password Verification]], [[User-Enumeration Mitigation]], [[OAuth State and Nonce]]
- **Related tests:** [[Authentication Tests]], [[Production Browser Acceptance]]
- **Provider dependency:** [[Google OAuth]] (optional; email/password has none)
- **Flow:** [[Login Flow]], [[Registration Flow]], [[Google OAuth Flow]]
- **Known issues:** no password-add-later path for a Google-first account ([[Known Issues and Limitations]])

Related: [[Authentication]] · [[Vault Setup]] · [[Vault Unlock]]
