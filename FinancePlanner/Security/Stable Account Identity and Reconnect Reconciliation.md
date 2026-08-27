---
type: security
domain: security
status: implemented
---

# Stable Account Identity and Reconnect Reconciliation

**Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass):** reconnecting the same real Mock ASPSP bank account produced a NEW Finance Planner account and re-imported all five historical transactions on top of it, doubling every balance/total (~€6,959.50 → €13,919.00). Root cause: account identity was keyed only to `connector:${provider}:${externalId}`, where `externalId` is Enable Banking's session-scoped `uid` — documented as "valid only until the session... is in AUTHORIZED status." A reauthorization always mints a new session, so the same real account always got a new `externalId`, which `buildSyncPreview()` (`src/connectors.ts`) treated as a brand-new account.

## The fix: a provider-agnostic stable account identity

`stableAccountId(env, provider, rawIdentifier)` in `server/src/providers.js` derives `HMAC-SHA256(CONNECTOR_MASTER_KEY, ${provider}:${rawIdentifier})` — the same secret this codebase already trusts to encrypt every provider credential — from a raw identifier the provider documents as stable across sessions:
- **Enable Banking:** `identification_hash`, confirmed against the current official API reference to be "based on the account number... can be used for matching accounts between multiple sessions (even in case the sessions are authorized by different PSUs)." Captured in `completeCallback()`'s account mapping and in `sync()`'s per-account metadata (both the `storedByUid` reuse path and the fresh `GET /accounts/{id}/details` fetch).
- **GoCardless:** `account.iban`, already referenced elsewhere in this codebase as a display-name fallback (`server/src/providers.js`'s `GoCardlessProvider.sync()`).

Never the raw value itself: the browser and Finance Planner's own encrypted cloud state only ever see the HMAC digest (`ExternalAccount.stableId` → `Account.stableId`), bounded to the same `MAX_EXTERNAL_ID_LENGTH` as `externalId` in both `server/src/user-state-store.js`'s `validateAccount()` and `src/validation.ts`'s `isAccount()`. Returns `undefined` (never throws) when the raw identifier is absent, malformed, or `CONNECTOR_MASTER_KEY` is unavailable — a sync with no trustworthy stable identity degrades to the pre-existing externalId-only path rather than fabricating one.

## Reconciliation in `buildSyncPreview()`

For each external account in a sync payload:
1. If its `externalId` matches an EXISTING account's id exactly (`connector:${provider}:${externalId}`) — unchanged, pre-existing behavior (same session, routine re-sync).
2. Otherwise, if its `stableId` matches an EXISTING account's `stableId` — this is a **reconnect**: the existing Finance Planner account id is reused (`accountsToUpdate`, refreshing `externalId`/balance/`lastSyncedAt`/`creditCard` in place) instead of creating a new one.
3. No stableId match on either side → falls through to the original create-new-account behavior. Never an unsafe automatic merge.

**Found by adversarial review (2026-08-27), fixed same pass:** step 2's match had no "already claimed this sync" tracking — two *different* external accounts sharing one `stableId` in the same payload (a realistic GoCardless case: sub-accounts documented to share one IBAN for some banks, not only an adversarial scenario) would both match the same existing account, silently merging two distinct real accounts' transaction histories into one — the same class of bug this whole fix exists to prevent, from the opposite direction. Fixed with a `claimedAccountIds` set: once an existing account id is claimed (by id or by stableId) within one `buildSyncPreview()` call, a second external account cannot also claim it — it creates its own new account instead.

The sync-selection screen (`ConnectionsPage.tsx`'s `SyncSelectionScreen`) labels a reconnect-matched row "Already in Finance Planner — refreshing balance" instead of presenting it identically to a genuinely new account — found during design review: a safe-but-silent reconciliation is still a UX defect if the user can't tell it isn't creating a duplicate.

## A second identity: `stableTransactionId` (fixed 2026-08-27, independent review, "Blocker 3")

Reusing the reconnect-matched account's id made the pre-existing `transactionFingerprint()` (accountId + date + amountCents + normalized description) function as the de facto reconnect-dedup key. That fingerprint can collapse two **genuinely different** same-day/same-amount/same-description transactions (e.g. two identical REWE purchases) — exactly the failure mode a prior requirement said this fix must not reintroduce.

`stableTransactionId(env, provider, accountStableId, transactionReference)` in `server/src/providers.js` derives `HMAC-SHA256(CONNECTOR_MASTER_KEY, ${provider}:${accountStableId}:${transactionReference})` from a bank-assigned transaction reference, **namespaced under the account's own proven-stable identity, never the session-scoped account/requisition id**:
- **Enable Banking:** `entry_reference`. Confirmed against the current official API reference that Enable Banking does **not** document this as cross-session stable the way account-level `identification_hash` explicitly is — but it IS documented as "the ASPSP transaction identifier," i.e. assigned by the bank, not by the session. That is the same structural property already relied on for account-level stability; namespacing it under the account's own stable identity is what turns it into something meaningfully more trustworthy across a reconnect, without claiming a documentation guarantee that doesn't exist.
- **GoCardless:** `transactionId`, documented as "Transaction identifier provided by the financial institution" — the same structural property.
- **PayPal:** deliberately not given a `stableTransactionId` in this pass. PayPal's owner-mode connection has no per-consent reconnect flow analogous to Enable Banking/GoCardless (no `stableAccountId` concept exists for it either) — there is no reconnect-duplication bug to fix here, so none was introduced.

`buildSyncPreview()`'s transaction loop now checks, in order: (1) exact `id` match (same-session re-sync, unchanged); (2) if the incoming transaction has a `stableTransactionId`, exact match against known transactions' own `stableTransactionId` — authoritative, never fuzzy; (3) otherwise, **only for accounts that were NOT reconnected this sync**, the pre-existing fuzzy fingerprint fallback (unchanged, routine-case behavior). A reconnected account's transaction with no `stableTransactionId` is **imported rather than risked as a false duplicate** — conservative by design, per the explicit requirement to prefer import over silently losing a real transaction.

`Transaction.stableTransactionId` / `ExternalTransaction.stableTransactionId` (both optional strings) were added to the domain model, the server's `validateTransaction()` allow-list, and the frontend's `isTransaction()` guard — same bound (`MAX_EXTERNAL_ID_LENGTH`) and "absent is valid, present-but-malformed fails closed" contract as every other stable-identity field in this codebase.

## Durable suppression: Dashboard "Remove account" (revised 2026-08-27 — see below)

Removing a provider-linked account (`src/features/dashboard/Dashboard.tsx`, domain logic in `src/accountState.ts`'s `removeAccountFromState()`) records a durable exclusion keyed by the account's `stableId`, so future syncs of that connection never re-import it. See [[Bank Disconnect Flow]] for how this interacts with disconnect.

### Coordinated removal (fixed 2026-08-27, independent review, "Blocker 2")

**Original defect:** `App.tsx` removed the account from local state FIRST, then fired `void excludeProviderAccount(...).catch(() => {})` — fire-and-forget. A network failure left the account "removed" in the UI (and the confirmation dialog had already told the user it would never come back) while the server never actually recorded the exclusion; the very next sync could resurrect it. Separately, a provider account with **no `stableId`** was still removable even though there is no trustworthy key to durably exclude it by.

**Fix:** `App.tsx`'s `removeAccount(account)` is now a single coordinated async operation. For a provider-linked account: (1) refuse immediately if `account.stableId` is absent — Dashboard pre-empts this even earlier, before offering any destructive action at all, via `removeTargetCannotBeRemovedSafely`; (2) `await excludeProviderAccount()` — the durable, connection-independent exclusion write (see below) — **before** touching local `AppState` at all; (3) only on success does the account/its transactions actually leave local state. On failure, local state is untouched and the caller receives `{ok:false,error}`. Dashboard's confirmation dialog shows a "Removing account…" busy state (both buttons disabled, no duplicate submission possible) and, on failure, an inline actionable error — re-clicking "Remove account" retries the same coordinated operation. Manual accounts remain synchronous/local-only (no server exclusion to coordinate with) and keep the short-lived Undo toast; provider accounts never get Undo, since a real server-side exclusion has already been recorded by the time Undo could be pressed.

The Dashboard confirmation copy ("This account will not be automatically re-imported...") is only ever shown on the path that can actually make that promise true.

### Durable, connection-independent exclusion storage (fixed 2026-08-27, independent review, "Blocker 1")

**Original defect:** exclusions were stored as `excludedStableAccountIds` inside the SAME `connector_connections` row that `DELETE /api/connectors/:provider` (disconnect) deletes and a subsequent reconnect recreates from scratch. A full disconnect + reconnect of the same real bank therefore silently lost every exclusion — directly contradicting the requirement that a removed account survive reconnect of the same economic account. The PR description at the time incorrectly called this an accepted limitation; it is not.

**Fix:** a dedicated `connector_account_exclusions` table (migration 011), independent of `connector_connections`:

```sql
CREATE TABLE connector_account_exclusions (
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gocardless','finapi','paypal','enablebanking')),
  stable_account_id text NOT NULL CHECK (stable_account_id ~ '^[a-f0-9]{64}$'),
  account_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, stable_account_id)
)
```

`server/src/database.js`'s `addAccountExclusionMethods(store, pool)` attaches `addAccountExclusion`/`removeAccountExclusion`/`listAccountExclusions` onto the already-unified `store` object (mirroring the pre-existing `addWebhookEventState()` pattern), backed by this table for the Postgres driver and by a parallel `accountExclusions` structure inside `EncryptedStore` (`server/src/crypto-store.js`) for the file driver. `addAccountExclusion()` is `INSERT ... ON CONFLICT (user_id, provider, stable_account_id) DO NOTHING` — atomic and idempotent, no read-modify-write lost-update race. `account_name` is a non-sensitive display label captured at removal time (never a raw IBAN/account number) so the Restore UI (below) can show something meaningful.

`server.js`'s `buildSyncPayload()` now calls `store.listAccountExclusions(user, provider)` and feeds the plain array to `applyAccountExclusions()` (`server/src/account-exclusions.js`, now decoupled from the credential object entirely) — the filtering still happens server-side, before excluded account/transaction data ever reaches the browser. Disconnecting deletes only `connector_connections`; the exclusion row is untouched and is consulted again the moment the same real account resurfaces after a reconnect (matched by the same `stableId`, independent of the new session's `externalId`).

Account deletion (`server/src/account-deletion.js`) and the factory-reset script (`server/scripts/factory-reset.mjs`) were both updated to also clear this table — a full account/data wipe must not leave orphaned exclusion rows behind.

### Restore ("un-remove") — never an irreversible hidden tombstone

`DELETE /api/connectors/:provider/exclusions/:stableAccountId` deletes the exclusion row (`removeAccountExclusion()`), nothing more — it does not guess old local transactions back into existence. `listStoredConnections()` attaches each connection's `excludedAccounts` (stableAccountId + optional display name + `createdAt`, never a secret) so the Connections page's "Manage connection" screen (`ConnectionsPage.tsx`'s `AttentionScreen`) can render a "Removed accounts" list with an individual Restore button per account. Restoring only clears the suppression; a subsequent normal sync is what actually re-imports the account through the ordinary, reviewed import path (`buildSyncPreview()`).

## A second review round the same day found and fixed one more real regression

**"Removed accounts / Restore" silently disappeared after every sync.** `buildSyncPayload()` (the function behind both a manual "Refresh all" and the automatic post-provider-return sync) replaced `ConnectionsPage.tsx`'s entire `connections` array with its own response, but only `listStoredConnections()` (the mount-only `GET /api/connectors/connections` overview) attached `excludedAccounts` — so the Restore list vanished the instant a user synced, exactly the moment they were most likely to check it, even though the exclusion itself remained fully enforced server-side the whole time. **Fixed** by fetching `store.listAccountExclusions()` once per provider in `buildSyncPayload()` and attaching it to every connection object that function returns, on both its success and per-provider-failure branch.

A related, lower-severity UX gap found the same pass: `ConfirmationDialog`'s Escape/backdrop-click handlers call `onClose` unconditionally, bypassing the `busy` guard the Cancel/Confirm buttons already respect — dismissing the dialog while a removal was in flight could cause a later failure's error message to fire into an already-closed dialog and be silently lost (no data-integrity impact; a success still applied correctly either way). **Fixed** by guarding Dashboard's `onClose` with the same `removeBusy` check.

## Accepted non-issue

- **No backfill migration exists for the original (now-replaced) `excludedStableAccountIds`-inside-the-credential design.** This is confirmed harmless: that design was never live-deployed against real user data before this same-day fix replaced it, so no exclusion could ever have existed in that shape to migrate. The stale field name is not even read anymore; each provider's `sync()` still spreads `{...credential}` into the stored row, so an old key would ride along inertly if it somehow existed, but `applyAccountExclusions()` never looks at it.
- **Exclusion writes across two DIFFERENT accounts of the same connection do not race** — each is its own row (`INSERT ... ON CONFLICT (user_id, provider, stable_account_id) DO NOTHING`), verified against real Postgres with concurrent inserts on both the same and different `stableAccountId`s.

## Test coverage

`server/test/stable-account-id.test.js` and `server/src/account-exclusions.test.js` (unit-level derivation/filtering), `server/test/account-exclusion-store-postgres.test.js` (real-Postgres: survives disconnect+reconnect, concurrent-insert atomicity, idempotency, user/provider isolation, malformed-id rejection, bounded display name), `server/test/open-banking-server-boundary.test.js` (`buildSyncPayload()` attaches `excludedAccounts` on both its success and failure branch, fetched outside the try block), `src/connectors.test.ts`'s "reconnect reconciliation (stableId)" and "stable transaction identity" suites (scenarios A–G from the live defect reports, the two-accounts-share-one-stableId collision guard, the two-legitimate-transactions-same-day preservation test), `src/accountState.test.ts`, `src/features/dashboard/Dashboard.test.tsx`'s "Remove account" suite (busy state, failure/retry, fail-conservative no-stableId path, the Escape-during-busy guard), `src/App.test.tsx` (the real coordinated-removal orchestration, not a mocked stand-in), `src/features/connections/ConnectionsPage.test.tsx`'s "Restore" suite (including the Restore list surviving a sync, not only a fresh mount). All verified genuine via spot-revert (fail against the pre-fix code, pass against the fix).

**Status: code-fixed, test-verified only — NOT yet live-verified.** No Mock ASPSP pass has yet exercised a reconnect of the same account with these fixes in place. See [[Provider Status]].

Related: [[Enable Banking]] · [[GoCardless]] · [[Provider Status]] · [[Connections Page]] · [[Dashboard Page]] · [[Accounts Page]] · [[Account (data model)]] · [[user_finance_state (table)]] · [[Bank Disconnect Flow]] · [[Provider Callback Binding]] · [[Known Issues and Limitations]]
