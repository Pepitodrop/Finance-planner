# Authentication

## Modes

`AUTH_MODE` selects the auth mode: `google` (Compose default), `local` (dev-only, mints unauthenticated sessions — hard-blocked in production by `runtime-security.js`). See [[Security Decisions]] for the enforcement detail.

## Google OAuth

Implemented in `server/src/auth-router.js` via `google-auth-library`'s `OAuth2Client`: `/api/auth/google/start` sets `state`+`nonce` cookies; `/api/auth/google/callback` validates state, exchanges the code, verifies ID token audience/`email_verified`/nonce, then creates a session. Requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — throws "Google login is not configured" otherwise.

## WebAuthn / Passkeys

Server-side via `@simplewebauthn/server`: `/api/auth/passkeys/register/options`, `/register/verify`, `/authenticate/options`, `/authenticate/verify`. `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`. Client uses `@simplewebauthn/browser`. Unit-tested compatibility coverage in `server/test/passkey-authenticator-compatibility.test.js` (no real hardware, unit-level only).

## Sessions

`server/src/session-revocation.js` — HMAC-based session key derivation (requires `SESSION_SECRET` ≥32 chars), Postgres-backed revocation table, refreshed every ~30s. Cookie `fp_session`: `HttpOnly`, `SameSite=Lax`, `Secure` when origin is HTTPS.

## Test/demo accounts (non-production)

- `server/src/test-password-auth.js` — scrypt password auth gated by `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD_HASH`, only for user IDs prefixed `test:`.
- `server/src/test-account-provisioning.js` — deterministically derives a `test:<hash>` account for reviewer/demo/CI use.
- `server/src/test-enrollment.js` — time-limited (≤60 min), single-use passkey-enrollment token so CI/QA can enroll a passkey for a test account without real hardware.

These are explicitly scoped to non-production test accounts, not a substitute for Google/passkey auth in production.

## Verification state

Implemented and unit/router-tested (`auth-router.test.js`, `runtime-security.test.js`). **Not runtime-verified**: no CI workflow performs a live Google OAuth handshake, and CI's production-acceptance browser suite runs under `AUTH_MODE=local`. Physical-device passkey verification (Android/iOS/Windows over HTTPS) is explicitly documented in `docs/issue-105-live-verification.md` as requiring a human-recorded manual step — see [[Provider Status]].

Related: [[Security Decisions]] · [[Data and Persistence]] · [[Provider Status]]
