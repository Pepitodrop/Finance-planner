---
type: security
domain: security
status: implemented
---

# Provider Callback Binding

`activateConnection`'s `userId` comes from the verified signed state (`state.sub`), never from client-supplied input on the callback request — prevents a callback from being bound to the wrong user's account.

- **Re-confirmed fresh 2026-08-11 (`/ship`):** call-site read directly in `server.js`.

## Fixed 2026-08-18: GoCardless and PayPal-partner now actually route through this callback

Found during a `/plan-eng-review` continuation of PR #138: `GoCardlessProvider.start()` and `PayPalProvider.start()`'s partner branch sent the provider (GoCardless's requisition `redirect` field, PayPal's `returnToPartnerUrl`) the **raw client page URL**, not `/api/connectors/callback` — only PayPal owner mode actually constructed and hit this route (it self-redirects since there's no real external provider). This meant the nonce-consumption/replay-protection this note documents was dead code for 2 of 3 providers in production; `docs/OPEN_BANKING_ARCHITECTURE.md`'s own sequence diagram documented the callback-routed design, but the code diverged from it. Independently re-verified by reading `server/src/providers.js` and cross-checked by an outside-voice (Codex) review pass.

Fixed with a shared `callbackUrl(redirectUri, provider, state)` helper (`server/src/providers.js`) used by all three `start()` call sites, so every provider's return is now verified through this same signed-state/nonce-consumption path. The callback route itself (`server/src/server.js`) was also hardened: failures (expired/malformed/replayed state, unknown provider, already-consumed nonce) now redirect back into the app with a fixed, safe error code instead of dead-ending in raw JSON — and the success redirect now appends `?provider=<id>` (previously appended nothing at all, meaning even the pre-existing PayPal-owner success path likely never triggered the frontend's automatic "Checking connection…" sync).

**Stays PROVIDER-DEPENDENT/UNVERIFIED**: whether GoCardless/PayPal actually accept this exact redirect URL (some providers require an exact-match pre-registered redirect URI in their own dashboard config) cannot be verified without live credentials — see [[Provider Status]]. Test coverage: `server/test/gocardless-institution-directory.test.js`, `server/test/providers-hardening.test.js`, `server/test/open-banking-server-boundary.test.js`, `src/app/navigation.test.ts`, `src/features/connections/ConnectionsPage.test.tsx` — all cover the code we control; none can prove the provider boundary.

## Fixed 2026-08-18: pending credentials no longer overwrite a working connection before activation

A Codex adversarial review (during the same `/review` pass that found finding #1 above) surfaced that `createConnectionSetup` unconditionally overwrote the live `connector_connections` row the instant `/start` was called — including on reconnect — before the callback ever verified anything. An abandoned or failed reconnect therefore permanently lost the previously-working connection (its `requisitionId`, `lastSyncedAt`, `consentExpiresAt`), not just failed to add a new one.

Fixed with `server/migrations/002_pending_connection_setup.sql` (adds `oauth_nonces.pending_payload`) and a new `createPendingConnectionSetup()` store method (both `postgres-store.js` and the in-memory `crypto-store.js`) that stores the pending credential only alongside its single-use nonce. `activateConnection()` now reads the pending payload from the nonce row it's already atomically consuming, and only then writes/overwrites `connector_connections` — so a currently-working connection survives an in-flight or abandoned reconnect attempt untouched. `createConnectionSetup` itself is unchanged and still used by the unrelated Google Subscriptions flow, which has no separate activation step.

**Runtime verified** (not just unit-tested): re-ran `server/test/postgres-store.test.js` against a real, freshly-migrated `postgres:17-bookworm` container (not mocked) — confirmed the migration applies cleanly, a previously-set working connection survives `createPendingConnectionSetup`, and `activateConnection` correctly promotes the pending payload. This is local/CI-equivalent runtime evidence for the code path itself, not a production-deployment exercise.

Related: [[Security Index]] · [[OAuth State and Nonce]] · [[Bank Connection Flow]] · [[Provider Status]] · [[Provider Institution Selection Contract]]
