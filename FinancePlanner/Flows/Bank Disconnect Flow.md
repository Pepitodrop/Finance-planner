---
type: flow
domain: provider
status: implemented
---

# Bank Disconnect Flow

[[Connections Page]] → disconnect requested → `DELETE /api/connectors/:provider` (`server/src/server.js`) fetches the stored credential, calls the adapter's `disconnect(credential)`, then unconditionally deletes the corresponding row from [[connector_connections (table)]] (`DELETE FROM connector_connections WHERE user_id=$1 AND provider=$2`, [[postgres-store.js]]) regardless of what the provider call returned.

## Provider-side revocation is best-effort and honestly reported (fixed 2026-08-18)

Until this fix, no adapter in [[providers.js]] implemented `disconnect()` at all -- the endpoint only ever deleted the local row, so a GoCardless requisition stayed live at the provider indefinitely after a Finance Planner "disconnect." This note previously (incorrectly) described the intended architecture as already implemented; corrected to match code, per [[Memory System]]'s "code is authoritative over the vault" rule.

- `OpenBankingProvider.disconnect()` (base) returns `{ revoked: false, reason: 'not_supported' }` -- the safe default for any adapter that doesn't override it.
- `GoCardlessProvider.disconnect(credential)` calls `DELETE {GC_BASE}/requisitions/{id}/` (refreshing the token first if stale, same as `sync()`). A 2xx or 404 (already gone) resolves `{ revoked: true }`; any other failure resolves `{ revoked: false, reason: 'provider_error' }` -- it never throws, so a provider outage can never block the user's local disconnect.
- `PayPalProvider.disconnect()` resolves `{ revoked: false, reason: 'not_applicable' }` in both modes: owner mode is the deployment's own app-level client-credential access (not a per-user grant), and partner mode in this codebase syncs through the same client-credential flow rather than a stored per-merchant user token -- there is no PayPal-side, per-connection consent for either mode to revoke.
- The endpoint response (`{ disconnected: true, providerRevoked, providerRevokeReason }`) derives `providerRevoked` only from what the adapter actually confirmed -- it is never hardcoded true. `ConnectionsPage.tsx` shows a distinct, honest message when `providerRevokeReason === 'provider_error'` ("...we couldn't confirm the provider revoked access on their side") instead of the normal disconnect copy, so local and provider state diverging is surfaced, not hidden.

Verification: `server/test/provider-disconnect.test.js` (GoCardless success/404-idempotent/failure/token-refresh/no-requisition, PayPal owner+partner, base-provider default), `server/test/open-banking-server-boundary.test.js` (credential lookup precedes the revoke attempt, local removal is never inside the revoke `try` block, `providerRevoked` is derived not hardcoded), `src/features/connections/ConnectionsPage.test.tsx` (honest-failure-message case). Still unverified against a real GoCardless sandbox -- see [[Provider Status]].

## Interaction with per-account sync exclusion (added 2026-08-27, corrected same day)

Disconnecting a provider deletes only the `connector_connections` row (`store.remove()`). Account exclusions from Dashboard's "Remove account" feature (see [[Stable Account Identity and Reconnect Reconciliation]]) were originally stored *inside* that same row as `excludedStableAccountIds` -- an independent review correctly identified that this meant a full disconnect + reconnect of the same real bank silently lost every exclusion, directly contradicting the requirement that a removed account survive reconnecting the same economic account. That was a real defect, not an acceptable tradeoff.

**Fixed same day:** exclusions now live in a dedicated `connector_account_exclusions` table (migration 011) / a separate `EncryptedStore` structure for the file driver, entirely independent of `connector_connections`. Disconnect's `store.remove()` never touches it. A subsequent reconnect of the same real account (matched by its unchanged `stableId`, regardless of the new session's `externalId`) is still excluded from every sync until the user explicitly restores it via `DELETE /api/connectors/:provider/exclusions/:stableAccountId` (the Connections page's "Manage connection" screen). Verified against a real Postgres instance: an exclusion survives the `connector_connections` row being deleted and a fresh row being inserted for the same provider (`server/test/account-exclusion-store-postgres.test.js`).

Full account deletion (`server/src/account-deletion.js`) and factory reset (`server/scripts/factory-reset.mjs`) both explicitly clear `connector_account_exclusions` too, so a genuine full data wipe -- as opposed to an ordinary bank disconnect -- does correctly remove exclusion records.

## Disconnect deliberately leaves local accounts/transactions in place

Disconnecting a provider never removes the accounts or transactions it previously imported -- only the live `connector_connections` row goes away; the Finance Planner `Account`/`Transaction` rows those imports produced remain, by design (the user's own financial history isn't provider-owned). This is directly relevant to two mechanisms added 2026-08-27, PR #154, fourth independent review, both documented fully in [[Stable Account Identity and Reconnect Reconciliation]]:
- `unreconciledLegacyAccounts` narrows its "belongs to this connection" match to `institutionId` equality specifically because a later sync of a NEW bank connected through the SAME provider must not flag the old, disconnected bank's leftover local accounts as ambiguous -- they belong to a different `institutionId` even though they share a provider.
- An account left over from disconnect that predates `stableId` (or is a stale duplicate from an earlier bug) can be cleaned up from the Dashboard via "Remove local copy" -- a deliberately weaker, local-only removal, distinct from the durable-exclusion "Remove account" path, since there is no live connection left to exclude it from in the first place.

Related: [[Bank Connections]] · [[Connections Page]] · [[postgres-store.js]] · [[Provider Institution Selection Contract]] · [[Provider Status]] · [[Stable Account Identity and Reconnect Reconciliation]]
