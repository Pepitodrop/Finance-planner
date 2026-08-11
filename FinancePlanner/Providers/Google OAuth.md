---
type: provider
domain: auth
status: unverified
---

# Google OAuth (provider)

- **Implemented:** yes — `server/src/auth-router.js` via `google-auth-library`'s `OAuth2Client`
- **Configured:** optional (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); Compose default `AUTH_MODE=google`
- **Mocked:** no
- **Redirect/callback:** `/api/auth/google/start` (sets `state`+`nonce` cookies), `/api/auth/google/callback` (validates state, exchanges code, verifies ID-token audience/`email_verified`/nonce)
- **Server adapter:** [[auth-router.js]]
- **UI:** [[Login and Registration]]
- **Security controls:** [[OAuth State and Nonce]], [[Origin Validation]]
- **Test coverage:** `auth-router.test.js`, `runtime-security.test.js` (unit/router-level)
- **Live verified:** no — no CI workflow performs a live Google handshake; CI's acceptance suite runs under `AUTH_MODE=local`
- **Provider/device verified:** no · **Production verified:** no
- **Known blocker:** `docs/issue-105-live-verification.md` defers this to a manual, human-recorded step

Related: [[Providers Index]] · [[Google OAuth Flow]] · [[Authentication]] · [[Provider Status]]
