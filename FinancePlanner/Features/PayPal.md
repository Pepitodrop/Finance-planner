# PayPal

Implemented as one of the `OpenBankingProvider` adapters in `server/src/providers.js`, `kind: 'wallet-account-information'` — reporting/read-only, same "no money movement" security invariant as [[Bank Connections]].

## Modes

`PAYPAL_CONNECTION_MODE` = `owner` or `partner` (defaults to `partner` if `PAYPAL_PARTNER_MERCHANT_ID` is set, otherwise `owner`).

- **Owner mode** — monitors the PayPal Business account tied to the configured REST app via reporting APIs directly (server-side client-credential exchange, no user OAuth redirect). Verifies reporting access during setup, reads the EUR balance from the balance-reporting endpoint. Must also set `PAYPAL_OWNER_USER_ID` — setup and every sync fail closed for any other Finance Planner user, so one deployment's PayPal credentials can't expose the account to unrelated accounts. `docs/issue-105-live-verification.md` is explicit that "the owner-reporting fallback is not equivalent to third-party user authorization and must not be presented as such."
- **Partner mode** — provider-hosted partner onboarding path, requires `PAYPAL_PARTNER_MERCHANT_ID` + webhook verification.

## Token handling

Entirely server-side: `paypalAccessToken()` uses Basic-auth client-credential exchange. No PayPal secrets or tokens cross to the browser. `sync()` fetches EUR balance + paginated transaction report with a hard pagination cap (`MAX_PAYPAL_PAGES = 100`, throws past that) and maps results into the internal transaction/account shape.

## Owner-mode listing is user-specific (fixed 2026-08-14)

`GET /api/connectors` used to return `providerRegistry.list()` unfiltered, so an authenticated non-owner user saw owner-mode PayPal as available/configured and only learned it was forbidden after clicking through and hitting `start()`'s 403. `server/src/provider-access.js` now has a shared `ownerAccessState()` helper used by both `authorizeProviderUser()` (start/sync, throws) and the new `describeProviderForUser()` (listing, returns a sanitized unavailable descriptor with reason instead of the real `available`/`configured` — never the owner user id). See [[Provider Institution Selection Contract]] for the full fix and tests.

## UI must match the mode (fixed 2026-08-13)

The Connections confirmation step previously showed one fixed copy — "you'll be redirected to PayPal's official site to authenticate" — regardless of mode. That's accurate for partner mode but was actively misleading for owner mode, contradicting the invariant already documented above ("must not be presented as" third-party authorization). `ConnectionsPage.tsx`'s confirmation step now reads the provider descriptor's `mode` (from `GET /api/connectors`) and renders distinct copy per state: owner (explains it's the deployment owner's configured connection, no PayPal login happens), partner (hosted-onboarding redirect language), and unconfigured (explicit unavailable state, never a broken-looking "Continue" button). Covered by `src/features/connections/ConnectionsPage.test.tsx`.

## Partner-mode synchronization fails closed — no per-merchant data isolation exists (found + fixed 2026-08-18)

A Codex adversarial security review, independently verified against the actual code, found that `PayPalProvider.sync(credential)` never reads any per-merchant token from `credential` — it only reads `credential.lastSyncedAt`, and otherwise calls the exact same deployment-wide `paypalAccessToken()` client-credential flow as owner mode. Since `authorizeProviderUser`/`ownerAccessState` correctly place **no** owner restriction on partner mode (any authenticated user is meant to connect their own merchant account there), this meant: any authenticated user who started a partner-mode connection and synced would receive the **deployment owner's own PayPal reporting data**, not their own — a cross-tenant financial-data exposure, live the moment `PAYPAL_PARTNER_MERCHANT_ID` is configured. Root cause: no per-merchant OAuth token exchange (PayPal's actual Partner Referrals completion flow) exists anywhere in this codebase; `start()`'s partner branch does send the user to PayPal's real onboarding page, but nothing ever captures or stores the resulting merchant-specific grant.

Fixed by making `sync()` fail closed for `credential.mode === 'partner'` — throws a clear, honest error (surfaced to the user as the connection needing attention) instead of silently returning someone else's data. `start()` and the real PayPal onboarding redirect are unchanged (still legitimate value), only synchronization is blocked. This is a **safety fix, not a feature completion** — partner mode still does not actually work end-to-end; it now fails safely instead of leaking data. Building the real fix (per-merchant OAuth token exchange + refresh-token storage) is tracked as future work, not attempted here since it's a substantial new integration surface with no live PayPal partner sandbox available to verify it against.

Test: `server/test/providers-hardening.test.js` ("PayPal partner-mode synchronization fails closed...").

## Verification status

- `runtime-canaries.yml` checks PayPal control-plane access only (client-credential auth succeeds), credential-gated and non-blocking by default.
- `docs/issue-105-live-verification.md` requires a human to manually complete the sandbox redirect, confirm return, sync, refresh and disconnect — not CI-automated.

Verification state: **implemented (real API integration, server-side token handling, owner+partner modes) / not runtime or production verified.**

Related: [[Bank Connections]], [[Provider Status]], [[Security Decisions]]
