// Extracted from server.js (2026-08-27, PR #154, Dashboard account-removal
// feature) so this security-relevant logic is directly unit-testable --
// server.js itself calls `server.listen()` unconditionally at import time
// (no test-mode guard), so nothing defined inside it can ever be imported by
// a test without actually starting a real HTTP server as a side effect. This
// is a pure, stateless function; extracting it changes nothing about its
// behavior or server.js's route wiring.
//
// Revised same day: exclusions were originally stored as
// excludedStableAccountIds inside the live connector credential -- an
// independent review found this lost every exclusion whenever the
// credential was replaced (disconnect + reconnect), directly violating the
// requirement that a removed account survive reconnecting the same real
// bank account. Exclusions now live in a dedicated, connection-independent
// store (see database.js's addAccountExclusionMethods() / migration 011's
// connector_account_exclusions table); this module no longer reads or
// writes that storage itself -- it only filters a sync result given the
// list the caller already fetched from that durable store.

// stableAccountId() in providers.js always produces a 64-hex-character
// HMAC-SHA256 digest -- this is the only shape ever handed back to a
// browser as an ExternalAccount.stableId, so an exclusion request is
// required to match it exactly rather than accepting arbitrary client-
// supplied strings into durable storage.
const STABLE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{64}$/

export function isValidStableAccountId(value) {
  return typeof value === 'string' && STABLE_ACCOUNT_ID_PATTERN.test(value)
}

// Server-side enforcement of "removed provider account must not be silently
// re-created on the next sync" (Dashboard account removal): filters an
// already-synced adapter response down to the accounts (and their
// transactions) the user has NOT excluded, keyed by the same stableId
// reconciliation identity used to fix the reconnect-duplication blocker.
// Deliberately filters here, once, in the shared sync path -- not per-
// adapter and not client-side -- so a client can never bypass an exclusion
// merely by not applying it locally; the excluded account's data never
// leaves the server in the first place. An account with no stableId (the
// provider offered no trustworthy cross-session identity) can never match
// an exclusion, by construction -- nothing to key it by.
export function applyAccountExclusions(excludedStableAccountIds, accounts, transactions) {
  const excluded = new Set(Array.isArray(excludedStableAccountIds) ? excludedStableAccountIds : [])
  if (excluded.size === 0) return { accounts, transactions }
  const excludedExternalIds = new Set(accounts.filter((account) => account.stableId && excluded.has(account.stableId)).map((account) => account.externalId))
  if (excludedExternalIds.size === 0) return { accounts, transactions }
  return {
    accounts: accounts.filter((account) => !excludedExternalIds.has(account.externalId)),
    transactions: transactions.filter((transaction) => !excludedExternalIds.has(transaction.externalAccountId)),
  }
}
