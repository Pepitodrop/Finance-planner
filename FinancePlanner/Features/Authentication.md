# Authentication

## Modes

`AUTH_MODE` selects the auth mode: `google` (Compose default), `local` (dev-only, mints unauthenticated sessions — hard-blocked in production by `runtime-security.js`). See [[Security Decisions]] for the enforcement detail.

## Google OAuth

Implemented in `server/src/auth-router.js` via `google-auth-library`'s `OAuth2Client`: `/api/auth/google/start` sets `state`+`nonce` cookies; `/api/auth/google/callback` validates state, exchanges the code, verifies ID token audience/`email_verified`/nonce, then creates a session. Requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — throws "Google login is not configured" otherwise.

## Email/password (production, PR #131)

Alongside Google, `AuthGate.tsx`'s pre-auth screen offers normal email/password sign-in and registration as the second primary choice — never a third passkey button. `server/src/password-auth.js` implements salted `scrypt` hashing (`N=16384, r=8, p=1`, 64-byte derived key, random 16-byte salt, `format$salt$hash` encoding) and timing-safe verification (`crypto.timingSafeEqual`); passwords are validated server-side (12–200 chars). Endpoints: `POST /api/auth/password/register` (`server/src/auth-router.js`) creates a `email:<uuid>` user, rejecting if `store.findByEmail` already finds that address; `POST /api/auth/password/login` verifies against `user.passwordHash`, OR — for the configured test account specifically — against `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD_HASH` for a `test:`-prefixed id. The dedicated collapsed test-password `<details>` UI that used to exist pre-redesign is gone; the test account now goes through this same general endpoint/UI, not a separate surface (`scripts/verify-test-password-leakage.mjs` independently proves no dedicated test-password copy ships in a normal production bundle).

**Same-account resolution:** both flows call `store.findByEmail(normalizedEmail)` before creating a user. Google's callback does `existing || { id: 'google:'+sub, ... }` then `Object.assign`s onto whichever object that is — so a user who already has an `email:<uuid>` account and later signs in with Google using the same verified email gets merged onto the *same* `id`, not a duplicate. The reverse direction (Google-first, then registering a password for that email) is blocked at register time (`store.findByEmail` finds the existing Google-created user and register throws "already exists") — a real UX gap (no password-add-later path) but not a duplicate-identity bug.

## WebAuthn / Passkeys

Server-side via `@simplewebauthn/server`: `/api/auth/passkeys/register/options`, `/register/verify`, `/authenticate/options`, `/authenticate/verify`. `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`. Client uses `@simplewebauthn/browser`. Unit-tested compatibility coverage in `server/test/passkey-authenticator-compatibility.test.js` (no real hardware, unit-level only).

**Never a primary pre-auth choice (PR #131 redesign):** `AuthGate.tsx`'s unauthenticated screen shows only Google + email/password; passkeys appear solely as an optional post-login "Add a passkey for faster sign-in" prompt (`.passkey-enrolment`, gated through the `runtime-surfaces` exclusivity system) and, once registered, as a status line on `AccountPage.tsx` (`user.passkeyCount`). `src/passkeys.ts` (`authenticateWithPasskey`, `switchAccount`, `listKnownAccounts`/`rememberAccount` "known accounts" switcher) is pre-redesign pre-auth passkey-login code that is no longer imported anywhere except its own test — a dead-code cleanup candidate, not currently wired into the UI.

## Sessions

`server/src/session-revocation.js` — HMAC-based session key derivation (requires `SESSION_SECRET` ≥32 chars), Postgres-backed revocation table, refreshed every ~30s. Cookie `fp_session`: `HttpOnly`, `SameSite=Lax`, `Secure` when origin is HTTPS.

## Test/demo accounts (non-production)

- `server/src/test-password-auth.js` — scrypt password auth gated by `TEST_ACCOUNT_EMAIL`/`TEST_ACCOUNT_PASSWORD_HASH`, only for user IDs prefixed `test:`.
- `server/src/test-account-provisioning.js` — deterministically derives a `test:<hash>` account for reviewer/demo/CI use.
- `server/src/test-enrollment.js` — time-limited (≤60 min), single-use passkey-enrollment token so CI/QA can enroll a passkey for a test account without real hardware.

These are explicitly scoped to non-production test accounts, not a substitute for Google/passkey auth in production.

## Verification state

Google OAuth, WebAuthn/passkeys: implemented and unit/router-tested (`auth-router.test.js`, `runtime-security.test.js`). **Not runtime-verified**: no CI workflow performs a live Google OAuth handshake, and CI's production-acceptance browser suite runs under `AUTH_MODE=local`. Physical-device passkey verification (Android/iOS/Windows over HTTPS) is explicitly documented in `docs/issue-105-live-verification.md` as requiring a human-recorded manual step — see [[Provider Status]].

Email/password: implemented, unit-tested (`server/test/password-auth.test.js`, `server/test/test-password-auth.test.js`), and browser-acceptance-verified end-to-end — `scripts/auth-security-production-acceptance.mjs` exercises real registration (name/password-confirmation fields, submit label) and login through the actual `/api/auth/password/register` and `/api/auth/password/login` endpoints against a real Postgres-backed connector (`AUTH_MODE=local` bootstraps the *session*, not the password path itself). Re-run locally 2026-08-09 against a fresh Postgres container + built preview, matching `production-acceptance.yml`: passed.

Related: [[Security Decisions]] · [[Data and Persistence]] · [[Provider Status]] · [[Debugging Learnings]]
