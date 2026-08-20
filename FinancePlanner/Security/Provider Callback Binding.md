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

## Fixed 2026-08-20: `activateConnection()` split into `consumePendingConnectionSetup()` + `finalizeConnection()`, plus a `completeCallback()` provider lifecycle step

Adding [[Enable Banking]] required a callback contract PR #138's single-step `activateConnection()` couldn't support: GoCardless/PayPal owner mode have their whole credential known at `start()` time, but Enable Banking's `session_id` is only known after exchanging the callback URL's authorization `code` via `POST /sessions` — a network call. Holding a DB transaction open across that call (which `activateConnection()`'s single atomic nonce-consume-and-promote step would have required) is the wrong shape for a network call to a third party.

Split into two provider-agnostic steps in both `postgres-store.js` and `crypto-store.js`:
- **`consumePendingConnectionSetup()`** — exactly the old nonce-DELETE-and-validate logic (same WHERE clause, same consentId/redirectUri cross-check, same expiry check), unchanged in substance and still one atomic local operation (no network I/O), so it stays replay-proof and single-use. Stops short of touching `connector_connections`.
- **`finalizeConnection()`** — the `connector_connections` promotion, now with a small bounded retry (3 attempts, short fixed delay) for a local DB write, because by the time this runs the nonce is already spent *and* the provider callback has already succeeded — for Enable Banking specifically, a real bank session already exists at their end, so a transient failure here is a worse outcome than one step earlier (an orphaned, undisconnectable provider-side session with zero local trace).

`OpenBankingProvider` gained `completeCallback({code, pending})` (default: identity pass-through, so GoCardless/PayPal needed **zero changes**). The server callback route (`server.js`) now always runs `consumePendingConnectionSetup → provider.completeCallback → finalizeConnection`, redirecting on failure at any step, with no provider-specific branching anywhere in the route.

**Why this doesn't weaken this note's guarantees**: nonce consumption is still one atomic local transaction; `finalizeConnection` is only ever reached after both the nonce check *and* the provider's own confirmation succeed, so a working connection is still never touched until that point (reconnect-preservation intact). The one new behavior: if `completeCallback()` fails, the nonce is already spent and the user must restart — inherent to any server-side code-exchange OAuth flow (the code itself is single-use at the provider too), not a regression.

Also added: a distinguishable `authorization_denied` error from `completeCallback()` when the callback carries no `code` at all (the user declined at the provider) — the server maps this to a new `error=access_denied` redirect, distinct from the generic `invalid_state` copy. This wires up `CALLBACK_ERROR_COPY.access_denied`, which PR #138's frontend had already defined but nothing server-side had ever set (GoCardless/PayPal's flows don't have a shape where the callback lands with no code at all; Enable Banking's does).

**Runtime verified** (real Postgres, not mocked): `server/test/postgres-store.test.js` covers a working connection surviving a `completeCallback()`-equivalent failure, the nonce still being single-use even when `finalizeConnection` never runs, and `finalizeConnection`'s bounded retry actually retrying a transient failure before giving up.

## Known gap, not fixed 2026-08-20: the split above widens a pre-existing concurrent-disconnect race

Found during the independent `/code-review` pass on PR #142, auditing callback replay protection and reconnect-preservation specifically. The nonce is burned by `consumePendingConnectionSetup()` *before* `completeCallback()`'s network exchange runs — so a `DELETE /api/connectors/:provider` landing while that exchange is in flight can be silently overwritten when `finalizeConnection()`'s `INSERT ... ON CONFLICT DO UPDATE` completes afterward, resurrecting the connection the user just disconnected. This window already existed under the old single-step `activateConnection()` (one local DB write wide); the split above widens it to a full network round-trip for any provider using `completeCallback()`, in practice only Enable Banking today.

Deliberately not fixed here — needs either an optimistic-concurrency version column on `connector_connections` or a disconnect-tombstone `finalizeConnection()` checks before writing, neither of which this persistence layer has today. See [[Known Issues and Limitations]] and the TODOS.md "Connections" section.

Related: [[Security Index]] · [[OAuth State and Nonce]] · [[Bank Connection Flow]] · [[Provider Status]] · [[Provider Institution Selection Contract]] · [[Enable Banking]] · [[Known Issues and Limitations]]
