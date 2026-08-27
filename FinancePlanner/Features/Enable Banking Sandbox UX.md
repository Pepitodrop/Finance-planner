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

The sandbox warning and CSS refinement are **IMPLEMENTED on PR #154 but not yet redeployed/re-verified live** since they landed.

**Updated 2026-08-25 — a real Mock ASPSP production run got further than this note previously recorded:**

- Enable Banking configuration: LIVE VERIFIED
- `/aspsps`: LIVE VERIFIED
- bank-family discovery/search/exact selection: LIVE VERIFIED
- real bank logos/logo proxy: LIVE VERIFIED
- `POST /auth` accepted: LIVE VERIFIED
- official Auth Flow widget rendering: previously live-observed before this UI refinement
- successful sandbox authorization: **LIVE VERIFIED** (Mock ASPSP, no real bank credentials needed)
- callback: **LIVE VERIFIED** — an `enablebanking` connector connection was persisted, the first ever in this codebase
- `POST /sessions`: **LIVE VERIFIED** (implied by the persisted connection)
- balances: NOT YET VERIFIED — the first sync after this persisted connection failed with a real provider HTTP 422 (an account-handling contract bug in `EnableBankingProvider.sync()`, unrelated to this note's UI work — see [[Enable Banking]]'s fourth-pass entry and [[Provider Status]] for the full root cause and fix). **Code-fixed, locally test-verified only, awaiting re-verification.**
- transactions: NOT YET VERIFIED — same block
- disconnect: NOT YET VERIFIED
- second-sync deduplication: NOT YET VERIFIED — blocked on the first sync succeeding live

This pass also exercised the provider-authorization **popup** bridge (`src/providerReturnBridge.ts`) against a real callback for the first time. Two review rounds on PR #154 found and fixed a total of five bugs in it: an unreachable popup-blocked fallback, later corrected into a genuine fail-closed rejection after a second review caught that the first fix's fallback would have recreated the vault-reset problem the bridge exists to prevent (see [[Rejected Approaches]]); its own test suite silently never executing for lack of a jsdom environment pragma; unbounded provider/error validation on the return signal; and a logout cleanup gap. See [[Provider Authorization Popup Bridge]] for full detail. Also code-fixed, awaiting runtime re-verification.

**Updated again 2026-08-25 — fifth pass, a temporary deployment carrying the fixes above:**

- **Popup opens, original tab stays mounted, original vault stays unlocked: LIVE VERIFIED.** This is the first live confirmation that the popup bridge's core purpose (no same-tab vault-reset regression) actually works in a real browser.
- **New defect found and fixed: concurrent-duplicate-callback race.** The connector logged two `GET /api/connectors/callback` deliveries for one authorization; the original tab accepted the faster one, which returned `invalid_state`, even though the slower delivery finalized the connection successfully moments later (confirmed by a read-only DB check). Root-caused and fixed with a claim lifecycle replacing immediate nonce deletion — see [[Provider Callback Binding]]'s "Fixed 2026-08-25: concurrent-duplicate-callback race" section. **Code-fixed, locally test-verified only (including against a real local Postgres container) — not yet re-verified live.**
- Balances/transactions/disconnect/second-sync-dedup: **still NOT YET VERIFIED** — this pass was blocked by the callback race before any of them could be trusted, same as before.

## Production use

A real Volksbank Köln Bonn connection belongs to a separate **Enable Banking production application**, not the sandbox application. Production and sandbox applications are separate environments and must not be conflated.

Related: [[Enable Banking]] · [[Enable Banking Auth Flow Widget]] · [[Bank Family Directory Resolution]] · [[Connections Page]] · [[Provider Status]] · [[Provider Callback Binding]] · [[Institution Logo Proxy]] · [[Rate Limiting]] · [[Provider Authorization Popup Bridge]]
