---
type: flow
domain: auth
status: provider-dependent
---

# Google OAuth Flow

[[Login and Registration]] → `POST /api/auth/google/start` sets `state`+`nonce` cookies, redirects to Google → user authenticates on Google's own site → `GET /api/auth/google/callback` validates `state`, exchanges code, verifies ID-token audience/`email_verified`/`nonce` → session created → [[Vault Unlock]]/[[Vault Setup]].

- **Provider:** [[Google OAuth]]
- **Security:** [[OAuth State and Nonce]], [[Origin Validation]]
- **Backend:** [[auth-router.js]] via `google-auth-library`'s `OAuth2Client`
- **Verification state:** implemented / **not runtime-verified** — no CI workflow performs a live handshake; CI's acceptance suite runs under `AUTH_MODE=local`

Related: [[Authentication]] · [[Provider Status]] · [[Google OAuth]]
