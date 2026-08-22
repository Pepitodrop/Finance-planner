---
type: feature
domain: connections
status: implemented-not-redeployed
---

# Enable Banking Sandbox UX

This note documents the user-facing boundary between Finance Planner's **Enable Banking sandbox** verification flow and the later **production** bank-connection flow.

## Why this distinction matters

The sandbox application does not authenticate against a user's real bank account. A real Volksbank Köln Bonn login can therefore be valid at the bank itself while the Enable Banking sandbox correctly rejects those credentials. Sandbox authorization must use the test credentials published by Enable Banking for the selected sandbox ASPSP.

Finance Planner must never ask a user to reuse real online-banking credentials in the sandbox.

## Current sandbox flow

```
Connections
  -> Connect an account
  -> choose/search a bank
  -> exact ASPSP resolution
  -> Step 3
  -> POST /api/connectors/enablebanking/start
  -> official <enablebanking-auth-flow> widget
  -> sandbox ASPSP authentication
  -> canonical /api/connectors/callback
  -> POST /sessions
  -> account/balance/transaction sync
  -> disconnect
```

For the next end-to-end verification, use **Aachener Bank** because Enable Banking publishes sandbox-only credentials for that integration. Do not use a real bank login.

## UX refinement — 2026-08-22

`src/features/connections/EnableBankingAuthFlow.tsx` now marks sandbox authorizations explicitly with a visible **Sandbox test** notice: use Enable Banking test credentials only and never credentials from a real bank account.

`src/features/connections/enableBankingAuthFlow.css` adds a Finance Planner presentation layer over the official widget. Enable Banking's current widget documentation explicitly states that the Auth Flow widget includes default CSS which may be overridden by the host page. The styling is scoped to the official custom element and changes presentation only:

- Finance Planner typography, spacing, controls, focus treatment and dark surfaces;
- clearer primary/secondary actions where Enable Banking exposes semantic classes;
- autofill paint normalized so credential fields do not become visually unrelated bright/olive blocks;
- responsive mobile layout and QR-code handling;
- provider error/status styling consistent with the surrounding modal.

Finance Planner still does **not** read, copy, mutate, store or log credential values or provider event payloads.

## Verification status

The sandbox warning and CSS refinement are **IMPLEMENTED on PR #144 but not yet redeployed/re-verified live**.

The prior live matrix remains unchanged until a new deployment is tested:

- Enable Banking configuration: LIVE VERIFIED
- `/aspsps`: LIVE VERIFIED
- bank-family discovery/search/exact selection: LIVE VERIFIED
- real bank logos/logo proxy: LIVE VERIFIED
- `POST /auth` accepted: LIVE VERIFIED
- official Auth Flow widget rendering: previously live-observed before this UI refinement
- successful sandbox authorization: NOT YET VERIFIED
- callback: NOT YET VERIFIED
- `POST /sessions`: NOT YET VERIFIED
- balances: NOT YET VERIFIED
- transactions: NOT YET VERIFIED
- disconnect: NOT YET VERIFIED

## Production use

A real Volksbank Köln Bonn connection belongs to a separate **Enable Banking production application**, not the sandbox application. Production and sandbox applications are separate environments and must not be conflated.

Related: [[Enable Banking]] · [[Enable Banking Auth Flow Widget]] · [[Bank Family Directory Resolution]] · [[Connections Page]] · [[Provider Status]] · [[Provider Callback Binding]] · [[Institution Logo Proxy]] · [[Rate Limiting]]
