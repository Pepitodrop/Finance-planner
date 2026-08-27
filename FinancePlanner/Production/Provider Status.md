# Provider Status

Strict, evidence-based status per external integration. "Code exists" is never treated as "verified working." See [[Memory System]] for source-of-truth precedence — re-check this note against current code/CI before relying on it for a release decision.

## Runtime-evidence rule

A workflow definition proves that a runtime check **can** be executed; it does not prove that a provider was successfully exercised. For external/provider/device-dependent integrations, any `Runtime verified` value other than `no`, `unknown`, or `n/a` must cite concrete dated execution evidence such as a successful GitHub Actions run and retained artifact/result. If no such execution evidence is pinned, keep the integration unverified rather than inferring success from workflow existence or unit tests.

For first-party internal flows with no external provider (for example Finance Planner email/password authentication), a local production-style runtime exercise may be recorded when the environment and real endpoints/storage used are stated explicitly. It must be labeled **local production-style runtime verified**, never simply "runtime verified," and it remains separate from **production-deployment verified** until the deployed production host is exercised.

---

## Enable Banking (bank data, AIS) — preferred provider

Implementation: **implemented** (real Enable Banking API client, `server/src/providers.js` `EnableBankingProvider`, `server/src/enable-banking-jwt.js`)
Configuration: **optional** (requires `ENABLE_BANKING_APPLICATION_ID` + `ENABLE_BANKING_PRIVATE_KEY_FILE` or `ENABLE_BANKING_PRIVATE_KEY`)
Provider-dependent: yes
Runtime verified: **partial — see live verification matrix, updated for the seventh pass (2026-08-27)**. Summary status:
- **Discovery: previously runtime verified.**
- **Authorization/callback/persistence: previously runtime verified** — the fourth pass (Mock ASPSP, no real bank credentials) completed authorization, callback, and persisted a real `enablebanking` connector connection for the first time in this codebase's history.
- **No-reunlock popup return: LIVE VERIFIED** (fifth pass, reconfirmed sixth/seventh passes) — a temporary deployment against the real Mock ASPSP sandbox (Firefox) confirmed the separate provider popup opens correctly, the original Finance Planner SPA remains mounted throughout, and the original vault remains unlocked throughout — the original same-tab vault-reset regression this whole mechanism exists to prevent did not reproduce.
- **Concurrent-duplicate-callback race fix: LIVE VERIFIED (sixth pass, 2026-08-26).** Found live on the fifth pass and code-fixed via a claim lifecycle (8fe1067, `oauth_nonces.claim_token` migration 010); confirmed working exactly as designed under real duplicate delivery. Full detail in [[Provider Callback Binding]]'s "Fixed 2026-08-25: concurrent-duplicate-callback race" section. **Do not regress this implementation.**
- **Account/balance/transaction sync: LIVE VERIFIED (sixth pass, reconfirmed seventh pass).** `POST /api/connectors/sync` returns 200 and imports real accounts/transactions/one pending-excluded transaction. The `CNCL`/`HOLD`/`OTHR`/`RJCT`/`SCHD` transaction-status filtering itself remains code/test-verified only — the fixture used has not been proven to contain any of those five statuses.
- **Cloud persistence: LIVE VERIFIED (seventh pass, 2026-08-27).** Found broken live on the sixth pass (`POST /api/finance/state` 400, "Unexpected accounts[0] field: externalId", forcing LOCAL MODE); fixed same day. The seventh pass's deployment confirmed `POST /api/finance/state` succeeding both before and immediately after a fresh connector import — the old LOCAL MODE condition did not recur. Root cause, fix, and test detail in [[user_finance_state (table)]].
- **Reconnect account-identity/dedup: found broken live (seventh pass, 2026-08-27), code-fixed same day, materially strengthened by four independent-review rounds since (eighth, ninth, and tenth passes, same day), still awaiting runtime re-verification.** A tenth-pass review round (same day) found the ninth pass's `institutionId`-scoped `unreconciledLegacyAccounts` guard was effectively inert for every real bank sync: neither Enable Banking's nor GoCardless's `sync()` ever set `institutionId` on the accounts they return, so a real import always produced `Account.institutionId === undefined` on both sides of the guard's comparison. Fixed by enriching every account `buildSyncPayload()` returns with the already-validated `stored.institutionId` (`withConnectionInstitutionId()` in `server/src/account-exclusions.js`), never a value read from the sync request itself. The same review round also found the exact duplicate account this codebase's own seventh-pass reconnect bug produced (and any account imported before `stableId` existed) was **permanently undeletable** from the Dashboard, since the existing "Remove account" flow correctly refuses any provider account without a `stableId` -- fixed with a new, deliberately weaker "Remove local copy" action (`removeLegacyAccountLocally()` in `App.tsx`) that removes the account/its transactions locally without ever writing a durable exclusion or claiming a suppression guarantee it cannot keep -- see [[Stable Account Identity and Reconnect Reconciliation]]'s "Legacy local account removal" section for the full distinction from the modern, durable-exclusion removal path. Reconnecting the same Mock ASPSP account (this pass started with the sixth pass's imported state already present) produced a duplicate account and doubled every historical transaction/balance/total. This was a financial-data-correctness defect, not a provider issue. The eighth-pass review round found two further real gaps in the original fix and closed both same day: (1) two external accounts sharing one `stableId` in a single sync could merge into one Finance Planner account (an account-identity collision guard was added); (2) the reconnect-dedup mechanism itself still relied on a fuzzy fingerprint that could collapse two genuinely different same-day/same-amount/same-description transactions -- fixed with a second stable identity, `stableTransactionId`, derived from a bank-assigned transaction reference namespaced under the account's own stable identity. **A ninth-pass review round (same day) found three further real gaps and closed all three:** (1) a routine same-connection refresh (no reauthorization) silently applied nothing -- neither a balance update nor a genuinely new transaction -- because the exact-id match path produced no update object at all, and the UI's "choose accounts" gate never fired without a discovered new/reconnected account; (2) legacy accounts/transactions predating `stableId`/`stableTransactionId` had no backfill path, so they could still mint a duplicate on a later genuine reconnect; (3) the fuzzy fingerprint fallback -- narrowed in the eighth pass to only non-reconnected accounts -- was removed entirely, since it could still collapse two genuinely distinct transactions on any account. A same-day adversarial-review follow-up on this ninth-pass diff additionally found and fixed: the occurrence-ordinal collision fix for absent-transaction-reference synthesis had only been applied to Enable Banking's adapter, leaving GoCardless with the identical silent-collapse bug; and the new "unreconciled legacy account" warning was scoped by provider only, which would have both false-flagged accounts belonging to a completely different live connection of the same provider, and nagged forever on a disconnected account with no `stableId` to ever resolve it (narrowed to `institutionId` equality on both sides). See [[Stable Account Identity and Reconnect Reconciliation]] for the full design. **Do not claim this fix live-verified until the next deployment explicitly exercises a reconnect of the same Mock account, a routine refresh with a genuinely new transaction, and a legacy-account backfill.**
- **ConnectionsPage persisted-connection display: found broken live (seventh pass, 2026-08-27), code-fixed same day, awaiting runtime re-verification.** Navigating away from and back to Connections made a genuinely still-connected card disappear. Not a provider defect — see [[Connections Page]]'s seventh-pass entry for the full fix (a new stored-connections overview endpoint) and the disconnect-race bug adversarial review found and fixed in it. Unaffected by the eighth-pass review round (confirmed untouched by that diff).
- **Dashboard account removal, durable exclusion, and Restore: code-fixed, test-verified only, not yet live-verified (eighth pass, 2026-08-27).** An independent review of the seventh pass's Dashboard "Remove account" feature found and fixed two further real gaps the same day: exclusions were stored inside the live connector credential and were silently lost on disconnect+reconnect (moved to a dedicated, independent `connector_account_exclusions` table); and removal was fire-and-forget (removed the account locally before confirming the server-side exclusion succeeded) -- now a single coordinated operation that only removes the account after the durable exclusion is confirmed, with a busy state and an actionable retry-on-failure UX, and a fail-conservative refusal when no stable account identity exists to exclude by. See [[Stable Account Identity and Reconnect Reconciliation]].
- **Second-sync deduplication: awaiting runtime verification** — blocked on the reconnect-identity fix above being re-verified live first (a routine second sync of the *same* unchanged session was never itself the blocker; the seventh pass's specific failure was a reconnect under a new session).
- **Disconnect/provider revocation: awaiting runtime verification** — never yet reached.
Production verified: **no evidence found** for the reconnect-identity-fix/persisted-connection-fix/second-sync-dedup/disconnect path. Institution discovery, logos, `/auth` acceptance, real bank authentication screens, authorization/callback/persistence, the no-reunlock popup mechanism, the concurrent-callback-race fix, first account/balance/transaction sync, and cloud persistence WERE exercised against sequential temporary production deployments (`finance.luisbenedikt.de`) of this codebase, against the real configured Enable Banking sandbox application — see matrix below.

### Live verification matrix (PR #144, three sequential temporary deployments against finance.luisbenedikt.de, 2026-08-21/22)

| Capability | Status | Evidence |
|---|---|---|
| Enable Banking configured/available | **LIVE VERIFIED = YES** | Connections UI showed it selectable |
| `GET /aspsps` (live directory) | **LIVE VERIFIED = YES** | Real response, 592 institutions returned for DE |
| Bank family discovery / institution filtering/search | **LIVE VERIFIED = YES** | "Volksbank / Raiffeisenbank" opened blank and showed real branches (Aachener Bank, Berliner Volksbank, Volksbank Köln Bonn, Volksbank Rhein-Erft-Köln, ...) with real BICs; "Berlin" and "Köln" searches worked |
| Exact-bank selection reaching Step 3 confirmation | **LIVE VERIFIED = YES** | Selecting a real bank reached the redirect-confirmation screen |
| Real bank logos | **LIVE VERIFIED = YES** | Screenshot showed real cooperative-bank logos rendering |
| Logo proxy (`GET /api/connectors/:provider/logo`) | **LIVE VERIFIED = YES** | Server logs: `GET /api/connectors/enablebanking/logo -> 200` |
| `POST /auth` request reaches Enable Banking | **LIVE VERIFIED = YES** (second pass) | A real, structured 400 response was received from the provider (see below), proving the request got there |
| `POST /auth` accepted | **LIVE VERIFIED = YES** (third pass, 2026-08-22) | No more `REDIRECT_URI_NOT_ALLOWED`; the browser reached `tilisy-sandbox.enablebanking.com/ais/` |
| Enable Banking pre-auth page reached | **LIVE VERIFIED = YES** (third pass) | "Authentication is initiated by Finance Planner" shown on the real sandbox host |
| Bank authentication page reached | **LIVE VERIFIED = YES** (third pass) | Real authentication-method selector (VR NetKey, PIN fields) for Volksbank Köln Bonn |
| Authorization successfully completed | **LIVE VERIFIED = YES** (fourth pass, 2026-08-25, Mock ASPSP) | No real bank credentials needed; the third pass's "NO" was specific to a real-bank (Volksbank Köln Bonn) credential attempt returning "Invalid credentials" from the external bank sandbox, not a Finance Planner defect |
| Consent (user completes bank-side auth) | **LIVE VERIFIED = YES** (fourth pass) | Completed via Mock ASPSP |
| Callback (`GET /api/connectors/callback`) | **LIVE VERIFIED = YES** (fourth pass) | Completed; an `enablebanking` connector connection was persisted -- the first ever in this codebase |
| `POST /sessions` (session exchange) | **LIVE VERIFIED = YES** (fourth pass) | Implied by a persisted connection |
| Balance sync | **NO** | Blocked: first sync failed with provider HTTP 422 (see fourth-pass entry below); fix is code-complete, not yet re-verified live |
| Transaction sync | **NO** | Same block |
| Second-sync deduplication | **NO** | Not yet exercised -- blocked on the first sync succeeding live |
| Disconnect | **NO** | Never reached |
| Official Auth Flow widget (`<enablebanking-auth-flow>`) | **IMPLEMENTED / LOCALLY VERIFIED only** | See [[Enable Banking Auth Flow Widget]] -- not yet redeployed/re-tested live |

**First live pass** failed with a generic "Internal server error" pressing "Continue securely" for Volksbank Köln Bonn. Root-caused (not confirmed via production logs on that pass — none were available — but confirmed against current official Enable Banking API docs and unit-tested): `EnableBankingProvider.start()` treated `match.maximum_consent_validity` (documented as **seconds**) as if it were already **days**, so the per-ASPSP consent-duration clamp never actually fired. Fixed (seconds→ms conversion) plus `access.balances`/`transactions: true` added, plus improved server-side (never client-facing) provider-error logging.

**Second live pass** (after redeploying the fix above, and after separately fixing a rate-limiter interaction where ordinary logo traffic could exhaust the sensitive bucket and starve `/start` — see [[Rate Limiting]]): the request now reached Enable Banking and received a **real, structured provider response** — `providerStatus: 400`, `providerCode: REDIRECT_URI_NOT_ALLOWED`, `providerMessage: "Redirect URI not allowed"` (request `d7eabbcb-e605-447c-920e-a6c1c6a1932f`). Root cause (confirmed from the real provider error, not guessed): `redirect_url` was built by appending `?provider=enablebanking&state=...` on top of the origin, which Enable Banking's Control Panel does not accept — its two registered redirect URLs (`https://finance.luisbenedikt.de/api/connectors/callback`, `http://localhost:5173/api/connectors/callback`) are validated as exact, bare strings. Fixed by deriving `redirect_url` independently from trusted server config (`canonicalCallbackUrl()`) instead of the browser-supplied return destination, and deriving the callback route's provider identity from the verified `state` payload instead of a client-supplied `?provider=` query parameter — full detail in [[Provider Callback Binding]]'s 2026-08-21 entry.

Both the redirect_uri fix and the rate-limit tier fix are **IMPLEMENTED / LOCALLY VERIFIED only** (full server+frontend test suites, `tsc -b --noEmit`, `eslint .`, `npm run build`, `git diff --check` clean; two independent gstack review subagents — security and correctness — found zero exploitable issues) **until we redeploy and repeat the real sandbox test.**

**Third live pass (2026-08-22):** after redeploying the two fixes above, `POST /auth` was **accepted** — the redirect_uri fix works end to end against the real provider. The browser reached `tilisy-sandbox.enablebanking.com/ais/` ("Authentication is initiated by Finance Planner") and progressed to a real bank authentication-method selector (VR NetKey, PIN) for Volksbank Köln Bonn. A credential attempt returned "Invalid credentials" from the external bank sandbox itself — not a Finance Planner code path, not evidence of any defect here. This pass motivated embedding Enable Banking's **official Auth Flow widget** so this pre-auth step happens inside Finance Planner's own modal instead of a full-page redirect to a generic Enable Banking-hosted page — see [[Enable Banking Auth Flow Widget]] for the full architecture, security review, and CSP change (IMPLEMENTED / LOCALLY VERIFIED only, including a real-browser-QA pass on the widget's loading/error shell states at all 5 required viewports — not yet exercised against the real widget script/live authorization).

**Mock ASPSP sandbox prep (2026-08-22), before any real Mock ASPSP test:** review ahead of the next real E2E pass (Enable Banking's Mock ASPSP — no real bank credentials, available in all countries) found and fixed three provider-contract bugs in `EnableBankingProvider.sync()` that would otherwise have surfaced as corrupted financial data on the very first successful sync: `transaction_amount.amount` is absolute (sign comes from `credit_debit_indicator`, previously ignored), `entry_reference` (not `transaction_id`) is the documented transaction identifier, and `PDNG` (not `PEND`) is the documented pending status. Full detail in [[Enable Banking]]'s 2026-08-22 entry. **IMPLEMENTED / LOCALLY VERIFIED only** — confirmed against current official documentation and covered by 29 tests against mocked responses (including a new synthetic EUR fixture run end-to-end through the real `sync()` pipeline), but no sync has ever run against a real Enable Banking session, mock or otherwise. **Do not mark Mock ASPSP E2E as LIVE VERIFIED until an actual Mock ASPSP sync has been observed.** Also confirmed (code-reading only, not yet live-observed): Finance Planner's existing live-directory top-level search (`searchLiveInstitutions`, matches on institution `name`/`bic`/`group.name`, queried with `country: 'DE'`) requires no new code to surface a real "Mock ASPSP" `/aspsps` directory entry if Enable Banking's sandbox actually returns one — no dedicated sandbox UI was added.

**Fourth live pass (2026-08-25), Mock ASPSP:** discovery, authorization, and callback all completed and an `enablebanking` connector connection was genuinely **persisted** for the first time in this codebase's history. The very first subsequent sync failed with a real provider **HTTP 422**. Root-caused (inspected, not guessed): `EnableBankingProvider.sync()`'s refresh of the account list from `GET /sessions/{id}` treated that endpoint's documented bare account-id-string `accounts` array as if it were `AccountResource` objects (the shape `POST /sessions` actually returns), so `account.uid` was always `undefined`, producing `/accounts/undefined/balances`. Fixed with a general account-handling contract fix (not an Mock-ASPSP special case): live session account ids are read as strings; previously-stored `POST /sessions` metadata is reused for an id still present; a genuinely new id gets real metadata from `GET /accounts/{id}/details` (never invented); a removed id is dropped from both the sync result and the persisted credential; every id is validated against a bounded safe-charset pattern with the whole sync failing closed otherwise. Also added Enable Banking's documented `strategy=longest` first-sync transaction request (proactive, not itself observed live). **Code-fixed, locally test-verified only (40 tests, including tests independently confirmed to fail without the fix and pass with it) — awaiting a fresh Mock ASPSP run after this PR is reviewed/deployed.** Full detail: [[Enable Banking]]'s fourth-pass entry.

This pass also exercised the pre-existing **provider-authorization popup bridge** (`src/providerReturnBridge.ts`) against a real provider callback for the first time. Reviewing it for this task surfaced two pre-existing bugs, both fixed the same session: (1) a blocked popup made `startConnector()` throw before ever reaching the documented same-tab-redirect/embedded-widget fallback, making that fallback unreachable dead code -- fixed at the time by catching the failure and falling through to that fallback; (2) `providerReturnBridge.test.ts` had no jsdom environment pragma, so its entire security-relevant test suite (attempt binding, provider-mismatch rejection, callback code/state/error_description leakage prevention) had silently never executed. Also added: clearing the popup-bridge's pending-attempt binding on logout (not on a vault lock), closing a narrow cross-user risk where a different user logging into the same browser tab could otherwise have a stale attempt's return signal accepted.

**A follow-up PR #154 review, same day, corrected fix (1) above**: falling through to a same-tab redirect/embedded widget after a blocked popup recreates the exact same-tab-unload regression this whole bridge exists to prevent -- a blocked popup must fail closed (reject before `/api/connectors/{provider}/start` is ever called, no provider-authorization nonce created, current tab never touched), not silently degrade to the unsafe path. Fixed by removing the catch entirely outside acceptance-fixture mode. The same review also found `parseSignal()` didn't actually bound the return signal's `provider`/`error` fields the way the bridge's own documentation claimed (any non-empty string was accepted) -- fixed with a fixed provider allow-list and a bounded error-code charset -- and that the logout cleanup above only removed the `sessionStorage` binding, leaving a matching `localStorage` return record behind -- fixed to remove both, best-effort. See [[Bank Connections]], [[Provider Callback Binding]], and [[Provider Authorization Popup Bridge]] for full detail.

**A third PR #154 review round, same day, found two deployment blockers plus a further transaction-contract gap:**
1. `ConnectionsPage.tsx` polled `popupAttempt.popup.closed` every 500ms to detect a manually-closed popup -- unreliable, because Finance Planner's `Cross-Origin-Opener-Policy: same-origin` header severs the opener's `WindowProxy` reference to the popup once it navigates cross-origin to the real provider, so `.closed` can read `true` while the authorization window is genuinely still open. Fixed by removing the polling entirely (not patching it -- no reliable alternative signal exists once the popup is on a cross-origin page) and replacing it with an always-available manual "Try again" action that abandons the current attempt before starting a fresh one.
2. `EnableBankingProvider.sync()` only checked for `PDNG`; the current official enum also has `CNCL`/`HOLD`/`OTHR`/`RJCT`/`SCHD`, all of which were silently imported as booked. Fixed to skip those five and fail closed on anything undocumented -- see the account/balance/transaction sync summary above.
3. (Hardening, not a blocker) `publishConnectorReturnFromPopup()`'s pre-React bootstrap short-circuit was triggered by URL shape alone (a valid `fp_connection_attempt`+`provider`/`error`), which a crafted URL in an ordinary tab could also satisfy. Fixed by requiring a `sessionStorage` marker that only the real popup ever receives (via the browser's spec'd one-time storage clone at `window.open()` creation time).
4. (Hardening, not a blocker) `AuthGate.tsx`'s `logout()` only ran the popup-bridge's browser-side cleanup after a successful server response. Fixed with `try/finally` so it always runs, while still only clearing client-side app state (`setUser(null)`) on an actual success.

Independently reviewed (2026-08-25): no CRITICAL/HIGH/MEDIUM findings across all four; one cosmetic stale-comment fix. Full detail, including why `Window.closed` and `window.name` were both rejected as unreliable and why the `sessionStorage`-clone mechanism was chosen instead: [[Provider Authorization Popup Bridge]].

## Fifth live pass (2026-08-25): a temporary deployment of the fixes above confirmed the popup/vault mechanism live, then found a concurrent-duplicate-callback race

**Verified live:** the separate provider popup opened correctly against Enable Banking's real Mock ASPSP sandbox (Firefox); the original Finance Planner SPA remained mounted throughout; the original vault remained unlocked throughout (the original same-tab vault-reset regression did not reproduce); `POST /api/connectors/enablebanking/start` returned 200 and authorization completed server-side; a connector connection was genuinely persisted (confirmed by a read-only PostgreSQL check matching the test's timestamp exactly). This is the first live confirmation of the no-reunlock popup mechanism itself, across all three PR #154 review rounds that hardened it.

**Runtime defect found:** the connector logged **two** `GET /api/connectors/callback` deliveries for that single authorization (~5ms and ~343ms apart). The original tab accepted the faster one, which returned `invalid_state`, even though the slower delivery finalized the same connection successfully moments later — a concurrent-duplicate-callback race can surface a spurious failure while the same attempt is still finalizing. Root-caused and fixed with a claim lifecycle (`oauth_nonces.claim_token`, `claimPendingConnectionSetup()`/`waitForPendingConnectionCompletion()`/`releasePendingConnectionSetup()`, the sequence extracted into a directly-testable `completeConnectorCallback()`) — full detail in [[Provider Callback Binding]]'s "Fixed 2026-08-25: concurrent-duplicate-callback race" section. Covered by 16 new unit tests (including a deterministic reproduction of the exact race) plus a real-concurrent-Postgres-clients test against an actual local Postgres container; independently reviewed (one MEDIUM finding — a claim-commit-ordering bug that could strand a nonce on a payload mismatch — found and fixed, with a dedicated regression test spot-verified to fail on the original ordering).

**Do not claim yet**: the concurrent-callback-race fix itself is live-verified (code-fixed and test-verified only); first balance sync is live-verified; first transaction sync is live-verified; second-sync deduplication is live-verified; disconnect is live-verified. This pass was blocked at callback-return handling before any of those could be trusted.

**Status: code-fixed, locally test-verified only (including against a real local Postgres container) — awaiting a fresh Mock ASPSP run with this fix in place.**

## Sixth live pass (2026-08-26): the callback-race fix and first sync both verify live; cloud persistence then rejects the imported account

A temporary deployment (head `c01a52be2eb4fa5353f615c8bfddf3ee8620bad9`) went past every blocker the fifth pass hit.

**Verified live:** the concurrent-duplicate-callback race fix (8fe1067 / migration 010) held exactly as designed under real duplicate delivery — see [[Enable Banking]]'s sixth-pass entry for the full timing/event detail. The original SPA/vault/popup mechanism held under an actual completed sync, not just a bare callback. `POST /api/connectors/sync` returned 200, importing 5 transactions and 1 account; the dashboard rendered real data (Net worth ~€6,959.50). The account-handling 422 fix from the fourth pass did not recur.

**New defect found (not a provider/Enable Banking failure):** immediately after the successful import, Finance Planner entered LOCAL MODE with "Unexpected accounts[0] field: externalId"; `POST /api/finance/state` returned 400 repeatedly. Root-caused to a stale server-side cloud-state schema validator (`validateAccount()`'s allow-list hadn't kept up with the Account domain type's connector-metadata fields), not to anything provider-specific — full detail in [[user_finance_state (table)]]. **Fixed same day** (32 new/updated tests, verified genuine via spot-revert; adversarially reviewed with no CRITICAL/HIGH/MEDIUM findings — encryption/AAD binding, version-conflict semantics, and the callback claim lifecycle confirmed untouched). **Code-fixed, test-verified only — NOT yet live-verified.** Because this blocked cloud persistence right after the first successful sync, second-sync deduplication and disconnect remain unreached and unverified live.

Current exact matrix as of this pass:

```
Enable Banking configuration: LIVE VERIFIED = YES
/aspsps: LIVE VERIFIED = YES
Bank family discovery: LIVE VERIFIED = YES
Search: LIVE VERIFIED = YES
Exact bank selection: LIVE VERIFIED = YES
Real bank logos: LIVE VERIFIED = YES
Logo proxy: LIVE VERIFIED = YES
POST /auth request reaches Enable Banking: LIVE VERIFIED = YES
POST /auth accepted: LIVE VERIFIED = YES
Enable Banking pre-auth page reached: LIVE VERIFIED = YES
Bank authentication page reached: LIVE VERIFIED = YES
Authorization successfully completed: LIVE VERIFIED = YES (fourth pass, Mock ASPSP)
Callback: LIVE VERIFIED = YES (fourth pass) -- connection persisted
POST /sessions: LIVE VERIFIED = YES (fourth pass, implied)
No-reunlock popup return (popup opens, SPA stays mounted, vault stays unlocked): LIVE VERIFIED = YES (fifth pass, reconfirmed sixth pass)
Concurrent-duplicate-callback race fix: LIVE VERIFIED = YES (sixth pass)
Balances: LIVE VERIFIED = YES (sixth pass)
Transactions: LIVE VERIFIED = YES (sixth pass)
CNCL/HOLD/OTHR/RJCT/SCHD status filtering: NO -- not proven present in the Mock ASPSP fixture used; code/test-verified only
Cloud persistence (POST /api/finance/state after a connector import): NO -- found broken live (sixth pass), code-fixed, awaiting re-verification
Second-sync deduplication: NO -- blocked on cloud persistence succeeding live
Disconnect: NO -- awaiting runtime verification
Official Auth Flow widget: IMPLEMENTED / LOCALLY VERIFIED only, not yet redeployed and actually tested.
```

## Seventh live pass (2026-08-27): cloud-state fix verifies live; reconnect duplicates an account, ConnectionsPage loses its connected display

A temporary deployment (head `129d8f62829097b28d831604cae0c32ed06ca550`) confirmed the sixth pass's fix and found two new, unrelated defects.

**Verified live:** `POST /api/finance/state` succeeded both before and immediately after a fresh connector import — the sixth pass's LOCAL MODE defect did not recur. **The connector Account.externalId cloud-state fix is now LIVE VERIFIED.** First sync also succeeded (5 transactions, 1 account, 1 pending transaction excluded, consistent with PDNG handling).

**New defect 1 (financial-data correctness, not a provider failure):** this pass started with the sixth pass's imported state already present. Reconnecting the same Mock ASPSP account produced a *second*, duplicate account and re-imported all five historical transactions on top of it, exactly doubling every balance/total (~€6,959.50 → €13,919.00; +€2,550.00 → +€5,100.00; -€259.99 → -€519.98). Root-caused to account identity being keyed only to Enable Banking's session-scoped `uid`, which changes on every reauthorization. **Fixed** with a provider-agnostic stable identity (`stableAccountId()` in `providers.js`, derived from Enable Banking's documented `identification_hash`) and a reconciliation update in `buildSyncPreview()` — full detail in [[Stable Account Identity and Reconnect Reconciliation]]. Adversarial review of the first version of this fix found and fixed one further real bug: two different external accounts sharing one stableId in the same sync could otherwise both match the same existing account, merging their transaction histories.

**New defect 2 (UI state, not a provider failure):** immediately after import, the Connections page showed "Bank connection / Connected"; navigating to Subscriptions and back made the card disappear and show the empty "Connect your financial accounts" state, with no `DELETE` request in the server log. Root-caused to `GET /api/connectors` never exposing the user's persisted connector rows, so a fresh `ConnectionsPage` mount had nothing to populate its local `connections` state from. **Fixed** with a new `GET /api/connectors/connections` endpoint — full detail in [[Connections Page]]'s seventh-pass entry. Adversarial review found and fixed one further real bug: the mount-time fetch could resolve after a disconnect completed while it was in flight, which would have resurrected the just-disconnected connection in the UI.

**Not yet verified from this pass:** second-sync deduplication of an *unchanged* session; disconnect/provider revocation; the reconnect fix and the persisted-connection fix themselves (both code-fixed, test-verified only).

**Status: both fixes code-fixed, test-verified only (adversarially reviewed — two real findings, both fixed and regression-tested; two lower-severity findings accepted as documented limitations, see [[Stable Account Identity and Reconnect Reconciliation]] and [[Bank Disconnect Flow]]) — NOT yet live-verified.** Do not claim either fix live-verified until the next deployment explicitly exercises a reconnect of the same Mock account and a Connections page navigate-away-and-back.

Current exact matrix as of this pass:

```
Enable Banking configuration: LIVE VERIFIED = YES
/aspsps: LIVE VERIFIED = YES
Bank family discovery: LIVE VERIFIED = YES
Search: LIVE VERIFIED = YES
Exact bank selection: LIVE VERIFIED = YES
Real bank logos: LIVE VERIFIED = YES
Logo proxy: LIVE VERIFIED = YES
POST /auth request reaches Enable Banking: LIVE VERIFIED = YES
POST /auth accepted: LIVE VERIFIED = YES
Enable Banking pre-auth page reached: LIVE VERIFIED = YES
Bank authentication page reached: LIVE VERIFIED = YES
Authorization successfully completed: LIVE VERIFIED = YES (fourth pass, Mock ASPSP)
Callback: LIVE VERIFIED = YES (fourth pass) -- connection persisted
POST /sessions: LIVE VERIFIED = YES (fourth pass, implied)
No-reunlock popup return: LIVE VERIFIED = YES (fifth pass, reconfirmed sixth/seventh)
Concurrent-duplicate-callback race fix: LIVE VERIFIED = YES (sixth pass)
Balances: LIVE VERIFIED = YES (sixth pass, reconfirmed seventh)
Transactions: LIVE VERIFIED = YES (sixth pass, reconfirmed seventh)
Cloud persistence (POST /api/finance/state after a connector import): LIVE VERIFIED = YES (seventh pass)
CNCL/HOLD/OTHR/RJCT/SCHD status filtering: NO -- not proven present in the Mock ASPSP fixture used; code/test-verified only
Reconnect account-identity/dedup: NO -- found broken live (seventh pass), code-fixed, awaiting re-verification
ConnectionsPage persisted-connection display: NO -- found broken live (seventh pass), code-fixed, awaiting re-verification
Second-sync deduplication (unchanged session): NO -- awaiting runtime verification
Disconnect: NO -- awaiting runtime verification
Official Auth Flow widget: IMPLEMENTED / LOCALLY VERIFIED only, not yet redeployed and actually tested.
```

Current limitations: same class of gap as GoCardless below — no completed end-to-end consent→sync→disconnect cycle evidenced against a live sandbox, and the redirect_uri fix above is **not yet re-verified live**. Do not mark the consent-duration fix LIVE VERIFIED either — the provider currently rejects on redirect_uri first, so another contract problem could still surface once that's corrected. Control Panel setup itself is confirmed already correct (discovery/JWT auth succeed live; both required redirect URLs are registered). See [[Enable Banking]], [[Bank Family Directory Resolution]], [[Institution Logo Proxy]], and [[Provider Callback Binding]].
Architecture note (2026-08-20): implementing Enable Banking required generalizing PR #138's callback contract — `OpenBankingProvider` gained a `completeCallback()` lifecycle step (a no-op pass-through for GoCardless/PayPal) because Enable Banking's session isn't known until after a server-side code exchange that happens *after* the callback lands, and `activateConnection()` was split into `consumePendingConnectionSetup()` (renamed `claimPendingConnectionSetup()` 2026-08-25 when its immediate-delete semantics were replaced with a claim lifecycle to fix a concurrent-duplicate-callback race — see the fifth-pass entry above and [[Provider Callback Binding]]) + `finalizeConnection()` so that exchange's network call never happens inside an open DB transaction. This is a structural change to the callback path all three bank/wallet providers now share; see [[Provider Callback Binding]] for why none of its existing guarantees (atomic single-use nonce, working-connection-preserved-until-verified) were weakened by either that split or the 2026-08-25 claim-lifecycle fix.
Confirmed during implementation (2026-08-20): GnuCOBOL's `VALIDATE-PROVIDER-CONSENT`, `NORMALIZE-PROVIDER-ACCOUNT-TYPE`, and `NORMALIZE-PROVIDER-AMOUNT` COBOL operations were already provider-agnostic where it mattered (a generic non-`gocardless` status-mapping branch already existed) — Enable Banking required zero COBOL source changes. Read directly from `core/cobol/banking/banking-core.cob` before relying on this, not inferred.
Deployment wiring (added 2026-08-20, **runtime-verified 2026-08-21**): `compose.yaml`'s connector service now sources `ENABLE_BANKING_APPLICATION_ID` from the host environment and bind-mounts the RSA private key read-only from `ENABLE_BANKING_PRIVATE_KEY_HOST_FILE` (defaulting to a committed, non-secret placeholder so deployments without Enable Banking still start cleanly). Originally verified only with `docker compose config`/`create`; PR #144's temporary live deployment has since exercised actual container boot with the real key (JWT signing and `GET /aspsps` succeeded live) — see [[Enable Banking]] for the full verification detail.
Relevant code/docs: `server/src/providers.js`, `server/src/enable-banking-jwt.js`, `server/migrations/009_enable_banking_provider.sql`, `.env.example`, `compose.yaml`

---

## GoCardless (bank data, PSD2 AISP) — fallback provider

Implementation: **implemented** (real GoCardless Bank Account Data API client, `server/src/providers.js` `GoCardlessProvider`)
Configuration: **optional** (requires `GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`)
Provider-dependent: yes
Runtime verified: **no dated successful canary artifact pinned** — `.github/workflows/runtime-canaries.yml` can check token creation and institution-list access when credentials exist, but the workflow definition itself is not execution evidence
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-09** — no specific successful `external-runtime-canaries` run/artifact is recorded here; no completed end-to-end consent→sync→disconnect cycle is evidenced in-repo, and `docs/issue-105-live-verification.md` requires this as a manual, human-recorded step
Current limitations: README lists "live GoCardless... certification and reconciliation testing" as outstanding; `docs/bank-connection-production.md` states passing unit tests explicitly does not substitute for deployment/sandbox evidence
Fixed (code-correctness, not new runtime evidence) 2026-08-13: the server used to ignore the client-selected institution and fall back to `institutions[0]`; it now validates every selection against a live, cached, sanitized institution directory and never guesses — see [[Provider Institution Selection Contract]]. This does not change the runtime/production-verified status above.
Fixed (code-correctness, not new runtime evidence) 2026-08-18: disconnect previously only deleted the local row -- no adapter revoked the provider-side requisition. `GoCardlessProvider.disconnect()` now calls GoCardless's `DELETE /requisitions/{id}/` best-effort (never blocking local disconnect, never claiming success it can't confirm) — see [[Bank Disconnect Flow]]. Still no live-sandbox evidence that this call succeeds against a real requisition; only unit-tested against a mocked GoCardless response.
Fixed (code-correctness, not new runtime evidence) 2026-08-18: the requisition's `redirect` field previously carried the raw client page URL instead of `/api/connectors/callback`, making the callback route's nonce-consumption/replay-protection dead code for GoCardless — see [[Provider Callback Binding]] for the full fix and [[Provider Institution Selection Contract]] for the security contract this restores.
Known limitation (not fixed, documented 2026-08-18): disconnect's `store.remove()` runs unconditionally even when provider revocation fails, so a transient GoCardless outage during disconnect permanently loses the local `requisitionId` needed to ever retry the revocation — see the TODOS.md "Connections" section entry. The consent stays live at GoCardless until it naturally expires; there is no automated or manual retry path today.
Fixed (code-correctness, runtime-verified against real Postgres, not against live GoCardless) 2026-08-18: reconnect always failed with `institution_required` (empty context submitted); a healthy connection had no Disconnect path in the UI at all; and `createConnectionSetup` unconditionally overwrote a working connection the instant any new setup began, losing it permanently on an abandoned reconnect. All three found by Codex adversarial review, independently verified, fixed — see [[Bank Connections]] and [[Provider Callback Binding]].
Role change (not a runtime-evidence change) 2026-08-20: GoCardless is now the **fallback** AIS provider — [[Enable Banking]] is preferred when configured and offers the selected bank. `GoCardlessProvider` itself is functionally unchanged; it now implements the shared `completeCallback()` lifecycle method as a no-op pass-through (added to support Enable Banking's server-side code exchange) and is promoted into `connector_connections` via the new `finalizeConnection()` split of `activateConnection()` — behaviorally identical to before, runtime-verified against real Postgres (`server/test/postgres-store.test.js`), not against live GoCardless. See [[Provider Callback Binding]] and [[Bank Connections]] for the full mechanism.
Relevant code/docs: `server/src/providers.js`, `.github/workflows/runtime-canaries.yml`, `scripts/provider-runtime-canary.mjs`, `docs/OPEN_BANKING_ARCHITECTURE.md`, `docs/issue-105-provider-setup.md`, `docs/issue-105-live-verification.md`, `docs/bank-connection-production.md`, `docs/bank-production-runbook.md`

---

## PayPal

Implementation: **implemented** (real PayPal REST client, owner + partner modes, `server/src/providers.js` `PayPalProvider`)
Configuration: **optional** (requires `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`; owner mode also requires `PAYPAL_OWNER_USER_ID`; partner mode also requires `PAYPAL_PARTNER_MERCHANT_ID`)
Provider-dependent: yes
Runtime verified: **no dated successful canary artifact pinned** — `.github/workflows/runtime-canaries.yml` can check client-credential token access when credentials exist, but the workflow definition itself is not execution evidence
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-09** — no specific successful `external-runtime-canaries` run/artifact is recorded here; no completed sandbox redirect→sync→disconnect cycle is evidenced in-repo, and `docs/issue-105-live-verification.md` requires manual human verification
Current limitations: owner mode is explicitly documented as *not* equivalent to third-party user authorization; README lists live PayPal certification as outstanding
Fixed 2026-08-13: the Connections confirmation UI previously showed one fixed "redirected to PayPal to authenticate" copy regardless of mode, which was inaccurate for owner mode (a documented invariant it was violating in production). It's now mode-aware — see [[PayPal]].
Fixed (code-correctness, not new runtime evidence) 2026-08-18: partner mode's `returnToPartnerUrl` previously carried the raw client page URL instead of `/api/connectors/callback`, making the callback route's nonce-consumption/replay-protection dead code for PayPal-partner (owner mode already routed through it correctly). Also fixed the same day: the callback route's success redirect appended no query params at all, so even the pre-existing owner-mode success path likely never triggered the frontend's automatic sync — see [[Provider Callback Binding]] for the full fix.
**Security fix 2026-08-18** (Codex adversarial review, independently verified): `PayPalProvider.sync()` had no per-merchant token isolation for partner mode — any authenticated user with a partner-mode connection received the deployment owner's own PayPal data. Fixed to fail closed (`sync()` throws for partner-mode credentials) rather than leak data; partner mode still does not functionally work end-to-end (tracked in TODOS.md "Connections" section — needs real per-merchant OAuth token exchange, not attempted without a live PayPal partner sandbox).
Relevant code/docs: `server/src/providers.js`, `.github/workflows/runtime-canaries.yml`, `scripts/provider-runtime-canary.mjs`, `docs/OPEN_BANKING_ARCHITECTURE.md` ("PayPal modes"), `docs/issue-105-live-verification.md`

---

## finapi

Implementation: **absent** (explicit unavailable placeholder in the provider registry, `server/src/providers.js`)
Configuration: n/a
Provider-dependent: yes (by design, once implemented)
Runtime verified: n/a
Production verified: n/a
Current limitations: intentionally not implemented yet; exists as a registry slot so a real adapter can be added without touching COBOL banking-domain rules
Relevant code/docs: `docs/OPEN_BANKING_ARCHITECTURE.md`

---

## Email/password (sign-in, PR #131)

Implementation: **implemented** (`server/src/password-auth.js` scrypt hashing/verification, `server/src/auth-router.js` `/api/auth/password/register` + `/api/auth/password/login`, `src/AuthGate.tsx` UI)
Configuration: **always available** (no external credentials — server-side-only, no third-party dependency)
Provider-dependent: no
Runtime verified: **local production-style: yes; deployed production host: no** — `scripts/auth-security-production-acceptance.mjs` drives real registration and login through the actual endpoints against a Postgres-backed connector (not mocked); re-run locally 2026-08-09 against a fresh `postgres:17-bookworm` container + `vite build` + `vite preview`, matching `production-acceptance.yml`. Passed. This verifies the real application path in a production-like local environment, not `finance.luisbenedikt.de` or any other deployed production host.
Production verified: **no evidence found** — the acceptance run above is local/CI-equivalent, not a production deployment exercise
Current limitations: a user who registered via Google first cannot later add a password to the same account (register rejects an already-known email) — no password-add-later path exists yet; this is a UX gap, not a security or duplicate-identity bug (see [[Authentication]])
Relevant code/docs: `server/src/password-auth.js`, `server/src/auth-router.js`, `src/AuthGate.tsx`, `scripts/auth-security-production-acceptance.mjs`

---

## Google OAuth (sign-in)

Implementation: **implemented** (`server/src/auth-router.js`, `google-auth-library` `OAuth2Client`, state/nonce/ID-token verification)
Configuration: **optional** (requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; Compose default `AUTH_MODE=google`)
Provider-dependent: yes
Runtime verified: **no evidence found** — no CI workflow performs a live Google OAuth handshake; CI's own production-acceptance browser suite runs under `AUTH_MODE=local`, not real Google auth
Production verified: **no evidence found**
Current limitations: `docs/issue-105-live-verification.md` explicitly defers live verification to a human-completed, human-recorded step
Relevant code/docs: `server/src/auth-router.js`, `server/src/runtime-security.js`, `docs/issue-105-live-verification.md`, `.github/workflows/production-acceptance.yml`

---

## WebAuthn / Passkeys

Implementation: **implemented** (`@simplewebauthn/server`, `server/src/auth-router.js`, resident-key + user-verification required; post-login enrollment in `src/AuthGate.tsx` via `@simplewebauthn/browser`)
Configuration: **configured** (no external credentials needed — relies on the browser/authenticator, not a third-party API)
Provider-dependent: no (standards-based, not a hosted provider) — but device/browser-dependent
Runtime verified: **no real-authenticator runtime evidence found** — unit-level compatibility coverage exists (`server/test/passkey-authenticator-compatibility.test.js`), but unit tests are not runtime evidence and do not exercise real authenticator hardware
Production verified: **no evidence found** — `docs/issue-105-live-verification.md` requires manual verification on Android, iOS and Windows over HTTPS with real hardware, explicitly not yet proven
Current limitations: enumeration-prevention fix landed 2026-08-02; physical-device matrix outstanding. The obsolete pre-redesign pre-auth passkey client (`src/passkeys.ts`) and its account-memory test were removed in PR #131; this does not remove the active post-login enrollment path.
Relevant code/docs: `server/src/auth-router.js`, `src/AuthGate.tsx`, `server/test/passkey-authenticator-compatibility.test.js`, `docs/issue-105-live-verification.md`

---

## Hosted AI (Hugging Face)

Implementation: **implemented** (`server/src/huggingFaceClient.js`, `ai-router.js`, `ai-ensemble.js`, consent-gated, revision-pinned, allowlisted)
Configuration: **optional** (requires `HF_TOKEN`; model/revision pinned via `ai/model-lock.json` + `HF_MODEL`/`HF_MODEL_REVISION`)
Provider-dependent: yes
Runtime verified: **no** — a concrete PR-linked evidence artifact exists, but it records a credential block rather than successful inference
Runtime evidence: GitHub Actions `Hosted AI acceptance` run **#81** (run id `31319731449`) on commit `6358c045fe55ac9f2088a887a9b517c10279505e`; artifact `hosted-ai-acceptance` (artifact id `9039803303`), created `2026-08-09T14:55:42Z`, digest `sha256:5f7fe0ed842f41dd1206fca15191230fae4fe6c811e7d87c258aa9214b144815`. Its `live-ai-acceptance.json` records `status: blocked_by_credentials`, `tokenConfigured: false`, and `liveVerification.verified: false` (`reason: live_acceptance_not_recorded`). This is evidence that the acceptance gate executed, **not** evidence that Hugging Face inference succeeded.
Production verified: **no evidence found** — `server/src/ai-capabilities.js` models "not verified" as its own default state (`liveVerification` defaults to `{ verified: false, reason: 'live_acceptance_not_recorded' }` unless `HF_LIVE_VERIFIED_AT` is explicitly set)
Current limitations: ordinary PR CI runs do not require a real successful hosted-inference call by default; `runtime-canaries.yml` skips rather than fails if `HF_TOKEN` is absent; hosted inference degrades to deterministic fallback on malformed/unavailable output by design
Relevant code/docs: `server/src/ai-capabilities.js`, `server/src/ai-ensemble.js`, `docs/HUGGINGFACE_AI.md`, `docs/AI_PRODUCTION.md`, `.github/workflows/hosted-ai-acceptance.yml`, `.github/workflows/runtime-canaries.yml`

---

## Local AI (Transformers.js / ONNX, browser-side)

Implementation: **implemented** (`src/aiModels.ts`, served from app origin, not a CDN)
Configuration: **configured** (no external account/credentials — models vendored/fetched from app origin)
Provider-dependent: no
Runtime verified: **unknown** — no explicit in-repo evidence of measured runtime behavior (load success rate, inference latency) across real browsers was found in this pass; `verify-ai.mjs` and related gate scripts run in CI but this report did not independently re-verify what exactly they assert
Production verified: **no evidence found**
Relevant code/docs: `src/aiModels.ts`, `README.md` ("AI architecture")

---

## Diagram

`diagrams/provider-connection-flow.mmd`, embedded in `docs/OPEN_BANKING_ARCHITECTURE.md`'s "Provider contract" section — the generic redirect/consent/callback sequence shared by GoCardless, PayPal, and Google subscriptions, with an explicit "NOT provider or production verified" note at the top of the diagram itself so the choreography being correct on paper is never mistaken for a completed live cycle. Added during `/diagram` (PR #131, 2026-08-11).

## Detailed subgraph

[[Providers Index]] mirrors this note's verification table as individually-linkable atomic nodes (one per provider, each with its own implementation/config/test/verification-state breakdown) so a specific provider can be reached directly from [[Pages Index]], [[Flows Index]], or [[Security Index]] without returning here first.

Related: [[Authentication]], [[Bank Connections]], [[Enable Banking]], [[PayPal]], [[AI System]], [[Known Issues and Limitations]], [[Rejected Approaches]], [[Providers Index]], [[Provider Callback Binding]], [[Bank Disconnect Flow]], [[Rate Limiting]], [[Institution Logo Proxy]], [[Enable Banking Auth Flow Widget]], [[Provider Authorization Popup Bridge]], [[user_finance_state (table)]], [[Stable Account Identity and Reconnect Reconciliation]], [[Connections Page]]
