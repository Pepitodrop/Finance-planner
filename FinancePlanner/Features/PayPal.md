# PayPal

Implemented as one of the `OpenBankingProvider` adapters in `server/src/providers.js`, `kind: 'wallet-account-information'` — reporting/read-only, same "no money movement" security invariant as [[Bank Connections]].

## Modes

`PAYPAL_CONNECTION_MODE` = `owner` or `partner` (defaults to `partner` if `PAYPAL_PARTNER_MERCHANT_ID` is set, otherwise `owner`).

- **Owner mode** — monitors the PayPal Business account tied to the configured REST app via reporting APIs directly (server-side client-credential exchange, no user OAuth redirect). Verifies reporting access during setup, reads the EUR balance from the balance-reporting endpoint. Must also set `PAYPAL_OWNER_USER_ID` — setup and every sync fail closed for any other Finance Planner user, so one deployment's PayPal credentials can't expose the account to unrelated accounts. `docs/issue-105-live-verification.md` is explicit that "the owner-reporting fallback is not equivalent to third-party user authorization and must not be presented as such."
- **Partner mode** — provider-hosted partner onboarding path, requires `PAYPAL_PARTNER_MERCHANT_ID` + webhook verification.

## Token handling

Entirely server-side: `paypalAccessToken()` uses Basic-auth client-credential exchange. No PayPal secrets or tokens cross to the browser. `sync()` fetches EUR balance + paginated transaction report with a hard pagination cap (`MAX_PAYPAL_PAGES = 100`, throws past that) and maps results into the internal transaction/account shape.

## UI must match the mode (fixed 2026-08-13)

The Connections confirmation step previously showed one fixed copy — "you'll be redirected to PayPal's official site to authenticate" — regardless of mode. That's accurate for partner mode but was actively misleading for owner mode, contradicting the invariant already documented above ("must not be presented as" third-party authorization). `ConnectionsPage.tsx`'s confirmation step now reads the provider descriptor's `mode` (from `GET /api/connectors`) and renders distinct copy per state: owner (explains it's the deployment owner's configured connection, no PayPal login happens), partner (hosted-onboarding redirect language), and unconfigured (explicit unavailable state, never a broken-looking "Continue" button). Covered by `src/features/connections/ConnectionsPage.test.tsx`.

## Verification status

- `runtime-canaries.yml` checks PayPal control-plane access only (client-credential auth succeeds), credential-gated and non-blocking by default.
- `docs/issue-105-live-verification.md` requires a human to manually complete the sandbox redirect, confirm return, sync, refresh and disconnect — not CI-automated.

Verification state: **implemented (real API integration, server-side token handling, owner+partner modes) / not runtime or production verified.**

Related: [[Bank Connections]], [[Provider Status]], [[Security Decisions]]
