---
type: provider
domain: provider
status: unverified
---

# GoCardless (provider)

- **Implemented:** yes — real GoCardless Bank Account Data API client, `server/src/providers.js` `GoCardlessProvider`
- **Configured:** optional (`GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`)
- **Mocked:** no
- **Server adapter:** [[providers.js]]
- **UI:** [[Connections Page]]
- **Security controls:** server-only credentials, [[Consent-State Classification]], [[Read-Only Scope Enforcement]]
- **Test coverage:** `src/bankConnection.test.ts`, `src/bankCallbacks.test.ts`, `src/bankProduction.test.ts`, `server/test/gocardless-institution-directory.test.js`
- **Live verified:** no dated successful canary artifact pinned — `runtime-canaries.yml` checks control-plane access only, credential-gated
- **Provider/device verified:** no · **Production verified:** no
- **Known blocker:** no completed end-to-end consent→sync→disconnect cycle evidenced in-repo; `docs/issue-105-live-verification.md` requires a manual human step
- **Institution selection:** fixed 2026-08-13 — the server previously ignored the client-selected institution and fell back to `institutions[0]`; it now validates the selection against a live, cached institution directory and never guesses. See [[Provider Institution Selection Contract]] for the full fix and its test coverage.
- **`transactionId` reconnect-identity: corrected 2026-08-27 (PR #154, third independent review) — never given a `stableTransactionId`.** An earlier pass reasoned GoCardless's `transactionId` was "bank-assigned, not session-scoped" and therefore as trustworthy as Enable Banking's `entry_reference` for cross-reconnect transaction identity. Independent verification found real evidence against this: a GoCardless status-page incident titled "UNICREDIT_BACXROBU internalTransactionId will change," and a corroborating firefly-iii GitHub issue (#10914) describing the id as "unique within an account, not globally across accounts" and able to change across retrievals. GoCardless has no equivalent of Enable Banking's FAQ-documented immutability guarantee. `GoCardlessProvider.sync()` now always sets `stableTransactionId: undefined` for GoCardless transactions — reconnect dedup for GoCardless falls back to the conservative "no trustworthy identity, preserve multiplicity" path in `buildSyncPreview()`. See [[Stable Account Identity and Reconnect Reconciliation]].
- **Silent-collapse bug in the `transactionId`-absent fallback, fixed 2026-08-27 (PR #154, adversarial-review follow-up to the third independent review's "Blocker 3"):** the same occurrence-ordinal fix applied to Enable Banking's adapter (see [[Enable Banking]]) was initially missed for `GoCardlessProvider.sync()`, which had the identical bug — its synthetic date/amount/description fallback key (used when `transactionId` is absent) was used directly as a `seen`-Set dedup key, silently collapsing two real, distinct transactions server-side. Found by a same-day adversarial review of the fix diff and closed in the same pass; now uses a per-`sync()`-call occurrence-ordinal suffix identical to Enable Banking's. Covered by `server/test/providers-hardening.test.js`.

Related: [[Providers Index]] · [[Bank Connections]] · [[Bank Connection Flow]] · [[Banking Core Module]] · [[Provider Institution Selection Contract]] · [[Stable Account Identity and Reconnect Reconciliation]] · [[Enable Banking]]
