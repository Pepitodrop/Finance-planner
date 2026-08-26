---
type: security
domain: security
status: implemented
---

# Stable Account Identity and Reconnect Reconciliation

**Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass):** reconnecting the same real Mock ASPSP bank account produced a NEW Finance Planner account and re-imported all five historical transactions on top of it, doubling every balance/total (~€6,959.50 → €13,919.00). Root cause: account identity was keyed only to `connector:${provider}:${externalId}`, where `externalId` is Enable Banking's session-scoped `uid` — documented as "valid only until the session... is in AUTHORIZED status." A reauthorization always mints a new session, so the same real account always got a new `externalId`, which `buildSyncPreview()` (`src/connectors.ts`) treated as a brand-new account.

## The fix: a provider-agnostic stable identity

`stableAccountId(env, provider, rawIdentifier)` in `server/src/providers.js` derives `HMAC-SHA256(CONNECTOR_MASTER_KEY, ${provider}:${rawIdentifier})` — the same secret this codebase already trusts to encrypt every provider credential — from a raw identifier the provider documents as stable across sessions:
- **Enable Banking:** `identification_hash`, confirmed against the current official API reference to be "based on the account number... can be used for matching accounts between multiple sessions (even in case the sessions are authorized by different PSUs)." Captured in `completeCallback()`'s account mapping and in `sync()`'s per-account metadata (both the `storedByUid` reuse path and the fresh `GET /accounts/{id}/details` fetch).
- **GoCardless:** `account.iban`, already referenced elsewhere in this codebase as a display-name fallback (`server/src/providers.js`'s `GoCardlessProvider.sync()`).

Never the raw value itself: the browser and Finance Planner's own encrypted cloud state only ever see the HMAC digest (`ExternalAccount.stableId` → `Account.stableId`), bounded to the same `MAX_EXTERNAL_ID_LENGTH` as `externalId` in both `server/src/user-state-store.js`'s `validateAccount()` and `src/validation.ts`'s `isAccount()`. Returns `undefined` (never throws) when the raw identifier is absent, malformed, or `CONNECTOR_MASTER_KEY` is unavailable — a sync with no trustworthy stable identity degrades to the pre-existing externalId-only path rather than fabricating one.

## Reconciliation in `buildSyncPreview()`

For each external account in a sync payload:
1. If its `externalId` matches an EXISTING account's id exactly (`connector:${provider}:${externalId}`) — unchanged, pre-existing behavior (same session, routine re-sync).
2. Otherwise, if its `stableId` matches an EXISTING account's `stableId` — this is a **reconnect**: the existing Finance Planner account id is reused (`accountsToUpdate`, refreshing `externalId`/balance/`lastSyncedAt`/`creditCard` in place) instead of creating a new one. Because the existing account id is reused, the pre-existing transaction-fingerprint dedup (`transactionFingerprint()`: accountId + date + amountCents + normalized description) naturally catches every historical transaction without any further change.
3. No stableId match on either side → falls through to the original create-new-account behavior. Never an unsafe automatic merge.

**Found by adversarial review (2026-08-27), fixed same pass:** step 2's match had no "already claimed this sync" tracking — two *different* external accounts sharing one `stableId` in the same payload (a realistic GoCardless case: sub-accounts documented to share one IBAN for some banks, not only an adversarial scenario) would both match the same existing account, silently merging two distinct real accounts' transaction histories into one — the same class of bug this whole fix exists to prevent, from the opposite direction. Fixed with a `claimedAccountIds` set: once an existing account id is claimed (by id or by stableId) within one `buildSyncPreview()` call, a second external account cannot also claim it — it creates its own new account instead. Covered by a dedicated regression test in `src/connectors.test.ts` proving each account's transactions land on its own account id, never collapsed together.

The sync-selection screen (`ConnectionsPage.tsx`'s `SyncSelectionScreen`) labels a reconnect-matched row "Already in Finance Planner — refreshing balance" instead of presenting it identically to a genuinely new account — found during design review: a safe-but-silent reconciliation is still a UX defect if the user can't tell it isn't creating a duplicate.

## Suppression: Dashboard "Remove account"

Removing a provider-linked account (`src/features/dashboard/Dashboard.tsx`, domain logic in `src/accountState.ts`'s `removeAccountFromState()`) fires a best-effort `POST /api/connectors/:provider/exclusions` with the account's `stableId` (only when both a provider prefix on the account id AND a `stableId` are present — never for manual accounts, never with an empty/absent value). The server (`server/src/account-exclusions.js`) appends it to a per-connection `excludedStableAccountIds` array stored alongside the (already encrypted) connector credential row — not in the strict Finance-state cloud schema, since this is a sync preference tied to the connection, not financial data itself. Every future sync (`server.js`'s `buildSyncPayload()`) calls `applyAccountExclusions()`, which filters any account (and its transactions) whose `stableId` is in that list OUT of the sync response **before it ever reaches the browser** — server-side enforcement, not a client-trust filter, so a removed account can't be silently re-created by a client that simply doesn't reapply the exclusion locally.

Manual accounts get a short-lived Undo toast (`src/App.tsx`); provider accounts do not — a fire-and-forget exclusion call has already happened by the time Undo could be pressed, and an Undo that doesn't also correctly reverse the server-side exclusion would be misleading.

## Known limitations (accepted, not fixed — proportionate to severity)

- **Exclusion write is a blind read-modify-write**, not compare-and-swap (`server.js`'s exclusion route: `store.get` then `store.set` with the merged array). Two near-simultaneous "Remove account" clicks on two different accounts of the *same* connection can race and lose one exclusion. Found by adversarial review, confidence 5/10, narrow window — the lost exclusion just means that one account can resync once more; removing it again is fully self-healing, no data corruption or security impact. Not engineered further given the severity.
- **A full disconnect + reconnect of the same bank does not carry exclusions forward** (a fresh stored row has no `excludedStableAccountIds`), so a previously-excluded account can reappear after that explicit user action. Found by adversarial review, confidence 7/10, flagged as needing product judgment rather than being a clear defect: the spec's "must not be silently re-created on the next sync" is read here as applying within one connection's ongoing lifecycle — a full disconnect is itself an explicit, deliberate "start over" action, not an ordinary sync.

## Test coverage

`server/test/stable-account-id.test.js` (determinism, provider/identifier/key separation, fail-conservative on every malformed input), `server/src/account-exclusions.test.js` (including the load-bearing case: exclusion matches by stableId even when externalId changes after a reconnect), `src/connectors.test.ts`'s "reconnect reconciliation (stableId)" suite (scenarios A–F from the live defect report, plus the two-accounts-share-one-stableId collision guard), `src/accountState.test.ts`, `src/features/dashboard/Dashboard.test.tsx`'s "Remove account" suite. All verified genuine via spot-revert (fail against the pre-fix code, pass against the fix).

**Status: code-fixed, test-verified only — NOT yet live-verified.** The seventh Mock ASPSP pass found the reconnect-duplication defect live but did not (and could not, within that same pass) exercise this fix; a fresh Mock ASPSP deployment with this fix in place, including an explicit reconnect of the same Mock account, is required before this can be marked live-verified. See [[Provider Status]].

Related: [[Enable Banking]] · [[GoCardless]] · [[Provider Status]] · [[Connections Page]] · [[Dashboard Page]] · [[Accounts Page]] · [[Account (data model)]] · [[user_finance_state (table)]] · [[Bank Disconnect Flow]] · [[Provider Callback Binding]]
