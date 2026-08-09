# PayPal

Implemented as one of the `OpenBankingProvider` adapters in `server/src/providers.js`, `kind: 'wallet-account-information'` — reporting/read-only, same "no money movement" security invariant as [[Bank Connections]].

## Modes

`PAYPAL_CONNECTION_MODE` = `owner` or `partner` (defaults to `partner` if `PAYPAL_PARTNER_MERCHANT_ID` is set, otherwise `owner`).

- **Owner mode** — monitors the PayPal Business account tied to the configured REST app via reporting APIs directly (server-side client-credential exchange, no user OAuth redirect). Verifies reporting access during setup, reads the EUR balance from the balance-reporting endpoint. Must also set `PAYPAL_OWNER_USER_ID` — setup and every sync fail closed for any other Finance Planner user, so one deployment's PayPal credentials can't expose the account to unrelated accounts. `docs/issue-105-live-verification.md` is explicit that "the owner-reporting fallback is not equivalent to third-party user authorization and must not be presented as such."
- **Partner mode** — provider-hosted partner onboarding path, requires `PAYPAL_PARTNER_MERCHANT_ID` + webhook verification.

## Token handling

Entirely server-side: `paypalAccessToken()` uses Basic-auth client-credential exchange. No PayPal secrets or tokens cross to the browser. `sync()` fetches EUR balance + paginated transaction report with a hard pagination cap (`MAX_PAYPAL_PAGES = 100`, throws past that) and maps results into the internal transaction/account shape.

## Verification status

- `runtime-canaries.yml` checks PayPal control-plane access only (client-credential auth succeeds), credential-gated and non-blocking by default.
- `docs/issue-105-live-verification.md` requires a human to manually complete the sandbox redirect, confirm return, sync, refresh and disconnect — not CI-automated.

Verification state: **implemented (real API integration, server-side token handling, owner+partner modes) / not runtime or production verified.**

Related: [[Bank Connections]], [[Provider Status]], [[Security Decisions]]
