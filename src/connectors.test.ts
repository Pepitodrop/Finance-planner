import { describe, expect, it } from 'vitest'
import { applySyncPreview, buildSyncPreview, selectSyncPreviewAccounts, transactionFingerprint, type SyncPayload } from './connectors'
import type { AppState, Transaction } from './types'

const state: AppState = {
  accounts: [{ id: 'manual', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
  transactions: [{ id: 'existing', accountId: 'manual', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 2500, date: '2026-07-20' }],
  goals: [],
}

const payload: SyncPayload = {
  connection: { id: 'connection-1', provider: 'gocardless', displayName: 'Testbank', status: 'connected' },
  accounts: [
    { externalId: 'bank-account-1', name: 'Testbank Giro', type: 'checking', balanceCents: 250_000, currency: 'EUR' },
    { externalId: 'card-1', name: 'Testbank Visa', type: 'credit-card', balanceCents: -12_500, creditLimitCents: 50_000, pendingAmountCents: -2_000, currency: 'EUR' },
  ],
  transactions: [
    { externalId: 'tx-1', externalAccountId: 'bank-account-1', description: 'Gehalt Juli', amountCents: 200_000, currency: 'EUR', bookingDate: '2026-07-25' },
    { externalId: 'tx-2', externalAccountId: 'card-1', description: 'Kartenzahlung Café', amountCents: -850, currency: 'EUR', bookingDate: '2026-07-24' },
    { externalId: 'tx-pending', externalAccountId: 'bank-account-1', description: 'Vorgemerkt', amountCents: -5000, currency: 'EUR', bookingDate: '2026-07-26', pending: true },
  ],
}

describe('connector sync', () => {
  it('builds a preview and skips pending transactions', () => {
    const preview = buildSyncPreview(state, payload)
    expect(preview.accountsToCreate).toHaveLength(2)
    expect(preview.transactionsToImport).toHaveLength(2)
    expect(preview.pendingCount).toBe(1)
    expect(preview.accountsToCreate[1].creditCard?.amountOwedCents).toBe(12_500)
    expect(preview.accountsToCreate[1].creditCard?.availableCreditCents).toBe(35_500)
  })

  it('filters transactions when the user selects discovered accounts', () => {
    const preview = buildSyncPreview(state, payload)
    const selected = selectSyncPreviewAccounts(preview, ['connector:gocardless:card-1'])
    expect(selected.accountsToCreate.map((account) => account.id)).toEqual(['connector:gocardless:card-1'])
    expect(selected.transactionsToImport.map((transaction) => transaction.id)).toEqual(['connector:gocardless:tx-2'])
  })

  it('does not import the same external transaction twice', () => {
    const first = buildSyncPreview(state, payload)
    const imported = applySyncPreview(state, first)
    const second = buildSyncPreview(imported, payload)
    expect(second.accountsToCreate).toHaveLength(0)
    expect(second.transactionsToImport).toHaveLength(0)
    expect(second.duplicateCount).toBe(2)
  })

  it('does not count a learned category for a rejected duplicate', () => {
    const history: AppState = {
      ...state,
      accounts: [...state.accounts, { id: 'connector:gocardless:bank-account-1', name: 'Testbank', type: 'checking', balanceCents: 0, currency: 'EUR' }],
      transactions: [
        ...state.transactions,
        { id: 'history-2', accountId: 'manual', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 2000, date: '2026-07-19' },
        { id: 'connector:gocardless:duplicate', accountId: 'connector:gocardless:bank-account-1', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 2500, date: '2026-07-20' },
      ],
    }
    const duplicatePayload: SyncPayload = {
      connection: payload.connection,
      accounts: payload.accounts,
      transactions: [{ externalId: 'duplicate', externalAccountId: 'bank-account-1', description: 'REWE', amountCents: -2500, currency: 'EUR', bookingDate: '2026-07-20' }],
    }
    const preview = buildSyncPreview(history, duplicatePayload)
    expect(preview.transactionsToImport).toHaveLength(0)
    expect(preview.duplicateCount).toBe(1)
    expect(preview.quality.smartCategorized).toBe(0)
  })

  it('creates stable content fingerprints', () => {
    const transaction: Transaction = { id: '1', accountId: 'a', description: '  REWE   Markt ', category: 'x', type: 'expense', amountCents: 1000, date: '2026-07-01' }
    expect(transactionFingerprint(transaction)).toBe('a|2026-07-01|1000|rewe markt')
  })
})

// Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass): reconnecting
// the same real Mock ASPSP account minted a brand-new Finance Planner
// account id (keyed only to the provider-session-scoped externalId) and
// re-imported all five historical transactions on top of it, doubling
// every balance/total. stableId is the fix -- a provider-agnostic identity
// for the same real account across sessions (see server/src/providers.js's
// stableAccountId()).
describe('reconnect reconciliation (stableId)', () => {
  const STABLE_ID = 'a'.repeat(64)

  it('A. same connection, second sync with the same externalId: no duplicate account, no duplicate transactions (pre-existing behavior, unaffected)', () => {
    const first = buildSyncPreview(state, payload)
    const imported = applySyncPreview(state, first)
    const second = buildSyncPreview(imported, payload)
    expect(second.accountsToCreate).toHaveLength(0)
    expect(second.accountsToUpdate).toHaveLength(0)
    expect(second.transactionsToImport).toHaveLength(0)
  })

  // stableTransactionId is what makes this an AUTHORITATIVE dedup match,
  // not the fuzzy fingerprint -- see the "Blocker 3" describe block below
  // for the full identity-collapse regression this distinguishes.
  const STABLE_TX_ID = 'c'.repeat(64)

  it('B. reauthorization: same stable economic account, NEW session externalId, same historical transaction (same stableTransactionId) -> reuses the existing Finance Planner account id, updates balance in place, does not duplicate the historical transaction', () => {
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR', lastSyncedAt: '2026-08-26T00:00:00.000Z' }],
      transactions: [{ id: 'connector:enablebanking:old-session-uid:mock-tx-001', accountId: existingAccountId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01', stableTransactionId: STABLE_TX_ID }],
      goals: [],
    }
    const reconnectPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' }],
      transactions: [{ externalId: 'mock-tx-001', externalAccountId: 'new-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' }],
    }

    const preview = buildSyncPreview(before, reconnectPayload)
    expect(preview.accountsToCreate).toHaveLength(0)
    expect(preview.accountsToUpdate).toHaveLength(1)
    expect(preview.accountsToUpdate[0].id).toBe(existingAccountId)
    expect(preview.accountsToUpdate[0].externalId).toBe('new-session-uid')
    expect(preview.transactionsToImport).toHaveLength(0)
    expect(preview.duplicateCount).toBe(1)

    const applied = applySyncPreview(before, preview)
    expect(applied.accounts).toHaveLength(1)
    expect(applied.accounts[0].id).toBe(existingAccountId)
    expect(applied.accounts[0].externalId).toBe('new-session-uid')
    expect(applied.transactions).toHaveLength(1)
  })

  it('C. two genuinely distinct accounts with the same display name and balance but a DIFFERENT stable identity remain separate', () => {
    const existingAccountId = 'connector:enablebanking:acct-A'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'acct-A', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const secondAccountPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'acct-B', stableId: 'b'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
    }

    const preview = buildSyncPreview(before, secondAccountPayload)
    expect(preview.accountsToUpdate).toHaveLength(0)
    expect(preview.accountsToCreate).toHaveLength(1)
    expect(preview.accountsToCreate[0].id).not.toBe(existingAccountId)
  })

  // Found by adversarial review (2026-08-27): two DIFFERENT external
  // accounts sharing the SAME stableId in one sync payload (a realistic
  // GoCardless case -- sub-accounts documented to share one IBAN for some
  // banks, not only an adversarial one) must never both match the one
  // existing Finance Planner account -- that would silently merge two
  // distinct real accounts' transaction histories into one, the exact
  // class of financial-data-corruption bug this whole fix exists to
  // prevent, approached from the opposite direction.
  it('two external accounts sharing one stableId in the same sync: only the first claims the existing account, the second creates its own new account rather than merging', () => {
    const existingAccountId = 'connector:gocardless:acct-A'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'acct-A', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const collidingPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'gocardless', displayName: 'Testbank', status: 'connected' },
      accounts: [
        { externalId: 'new-acct-A', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' },
        { externalId: 'acct-B-sharing-iban', stableId: STABLE_ID, name: 'Unterkonto', type: 'checking', balanceCents: 5_000, currency: 'EUR' },
      ],
      transactions: [
        { externalId: 'tx-a', externalAccountId: 'new-acct-A', description: 'Account A transaction', amountCents: 1_000, currency: 'EUR', bookingDate: '2026-08-01' },
        { externalId: 'tx-b', externalAccountId: 'acct-B-sharing-iban', description: 'Account B transaction', amountCents: 500, currency: 'EUR', bookingDate: '2026-08-02' },
      ],
    }

    const preview = buildSyncPreview(before, collidingPayload)
    // Exactly one update (the genuine reconnect match) and exactly one new
    // account (the second, un-mergeable external account) -- never zero
    // creates (which would mean the second account's data was folded into
    // the first).
    expect(preview.accountsToUpdate).toHaveLength(1)
    expect(preview.accountsToUpdate[0].id).toBe(existingAccountId)
    expect(preview.accountsToCreate).toHaveLength(1)
    expect(preview.accountsToCreate[0].id).not.toBe(existingAccountId)
    expect(preview.accountsToCreate[0].name).toBe('Unterkonto')
    // Each account's own transaction is attributed to ITS OWN account id,
    // never both collapsed onto the existing account.
    const applied = applySyncPreview(before, preview)
    const accountATransactions = applied.transactions.filter((t) => t.accountId === existingAccountId)
    const accountBTransactions = applied.transactions.filter((t) => t.accountId === preview.accountsToCreate[0].id)
    expect(accountATransactions).toHaveLength(1)
    expect(accountATransactions[0].description).toBe('Account A transaction')
    expect(accountBTransactions).toHaveLength(1)
    expect(accountBTransactions[0].description).toBe('Account B transaction')
  })

  it('D. no stableId on either side: falls through to the pre-existing create-new-account behavior -- never an unsafe automatic merge', () => {
    const before: AppState = {
      accounts: [{ id: 'connector:enablebanking:old-uid', externalId: 'old-uid', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const noStableIdPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-uid', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
    }

    const preview = buildSyncPreview(before, noStableIdPayload)
    expect(preview.accountsToUpdate).toHaveLength(0)
    expect(preview.accountsToCreate).toHaveLength(1)
    expect(preview.accountsToCreate[0].id).toBe('connector:enablebanking:new-uid')
  })

  it('E. new real transaction after reconnect: old rows dedup (via stableTransactionId), the genuinely new transaction imports exactly once', () => {
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 250_000, currency: 'EUR' }],
      transactions: [{ id: 'connector:enablebanking:old-session-uid:mock-tx-001', accountId: existingAccountId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01', stableTransactionId: STABLE_TX_ID }],
      goals: [],
    }
    const reconnectPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 300_000, currency: 'EUR' }],
      transactions: [
        { externalId: 'mock-tx-001', externalAccountId: 'new-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' },
        { externalId: 'mock-tx-002', externalAccountId: 'new-session-uid', stableTransactionId: 'd'.repeat(64), description: 'Freelance payment', amountCents: 50_000, currency: 'EUR', bookingDate: '2026-08-15' },
      ],
    }

    const preview = buildSyncPreview(before, reconnectPayload)
    expect(preview.duplicateCount).toBe(1)
    expect(preview.transactionsToImport).toHaveLength(1)
    expect(preview.transactionsToImport[0].description).toBe('Freelance payment')
    expect(preview.transactionsToImport[0].accountId).toBe(existingAccountId)
  })

  it('selectSyncPreviewAccounts includes accountsToUpdate selections and their transactions, and excludes them when deselected', () => {
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 250_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const reconnectPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 300_000, currency: 'EUR' }],
      transactions: [{ externalId: 'mock-tx-002', externalAccountId: 'new-session-uid', description: 'Freelance payment', amountCents: 50_000, currency: 'EUR', bookingDate: '2026-08-15' }],
    }
    const preview = buildSyncPreview(before, reconnectPayload)

    const selected = selectSyncPreviewAccounts(preview, [existingAccountId])
    expect(selected.accountsToUpdate).toHaveLength(1)
    expect(selected.transactionsToImport).toHaveLength(1)

    const deselected = selectSyncPreviewAccounts(preview, [])
    expect(deselected.accountsToUpdate).toHaveLength(0)
    expect(deselected.transactionsToImport).toHaveLength(0)
  })
})

// Blocker 3 (found by independent review, 2026-08-27): the reconnect-dedup
// fix's fingerprint fallback (accountId + date + amountCents + description)
// could collapse two GENUINELY DIFFERENT same-day/same-amount/same-
// description transactions. stableTransactionId -- derived server-side from
// a provider's bank-assigned transaction reference namespaced under the
// account's own stable identity, never the session-scoped account id -- is
// the fix. See stableTransactionId() in server/src/providers.js.
describe('stable transaction identity (reconnect dedup correctness)', () => {
  const STABLE_ID = '9'.repeat(64)
  const ACCOUNT_ID = 'connector:enablebanking:acct-1'
  const baseAccount = { id: ACCOUNT_ID, externalId: 'acct-1', stableId: STABLE_ID, name: 'Girokonto', type: 'checking' as const, balanceCents: 100_000, currency: 'EUR' as const }
  const basePayloadAccount = { externalId: 'acct-1', stableId: STABLE_ID, name: 'Girokonto', type: 'checking' as const, balanceCents: 100_000, currency: 'EUR' as const }

  // Corrected 2026-08-27 (PR #154, third independent review): this test
  // previously used a historical transaction id
  // ('connector:enablebanking:acct-1:tx-1') that does NOT actually match
  // what buildSyncPreview() computes for externalId 'tx-1'
  // ('connector:enablebanking:tx-1') -- so it was silently passing via the
  // now-removed fuzzy date/amount/description fallback, not via genuine
  // exact-id matching as its own name claimed. Fixed to use a
  // realistic/consistent id so it actually exercises the exact-id dedup
  // path (Blocker 3, numbered scenario 3: "exact same entry_reference
  // /stableTransactionId -> true duplicate correctly skipped" -- the
  // same-session/no-reconnect variant of that guarantee, keyed by the
  // ordinary transaction id rather than stableTransactionId).
  it('A. exact same provider transaction id (same session, no reconnect) -> duplicate, correctly skipped', () => {
    const before: AppState = {
      accounts: [baseAccount],
      transactions: [{ id: 'connector:enablebanking:tx-1', accountId: ACCOUNT_ID, description: 'REWE', category: 'Groceries', type: 'expense', amountCents: 2000, date: '2026-08-27' }],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [{ externalId: 'tx-1', externalAccountId: 'acct-1', description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' }],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(0)
    expect(preview.duplicateCount).toBe(1)
  })

  // Blocker 3, numbered scenario 1 (verbatim): two same-session
  // transactions, same date/amount/description, DIFFERENT exact provider
  // ids, no stableTransactionId -> both preserved. This is exactly the case
  // the removed fuzzy fingerprint fallback used to silently collapse.
  it('1. two same-session transactions, same date/amount/description, DIFFERENT exact provider ids, no stableTransactionId -> both preserved', () => {
    const before: AppState = { accounts: [baseAccount], transactions: [], goals: [] }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [
        { externalId: 'tx-morning', externalAccountId: 'acct-1', description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' },
        { externalId: 'tx-evening', externalAccountId: 'acct-1', description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' },
      ],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(2)
    expect(preview.duplicateCount).toBe(0)
  })

  it('B. reconnect: same stableTransactionId, different session/external account id -> duplicate', () => {
    const stableTxId = 'e'.repeat(64)
    const before: AppState = {
      accounts: [{ ...baseAccount, externalId: 'old-session-acct' }],
      transactions: [{ id: 'connector:enablebanking:old-session-acct:tx-1', accountId: ACCOUNT_ID, description: 'REWE', category: 'Groceries', type: 'expense', amountCents: 2000, date: '2026-08-27', stableTransactionId: stableTxId }],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ ...basePayloadAccount, externalId: 'new-session-acct' }],
      transactions: [{ externalId: 'new-tx-ref', externalAccountId: 'new-session-acct', stableTransactionId: stableTxId, description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' }],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(0)
    expect(preview.duplicateCount).toBe(1)
  })

  it('C. two legitimate transactions, same account/date/amount/description, DIFFERENT stable transaction ids -> BOTH preserved', () => {
    const before: AppState = { accounts: [baseAccount], transactions: [], goals: [] }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [
        { externalId: 'tx-morning', externalAccountId: 'acct-1', stableTransactionId: 'f'.repeat(64), description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' },
        { externalId: 'tx-evening', externalAccountId: 'acct-1', stableTransactionId: '1'.repeat(64), description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' },
      ],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(2)
    expect(preview.duplicateCount).toBe(0)
  })

  it('D. reconnect, same display data, NO stable transaction identity on either side -> conservative import, never silently discarded as a duplicate', () => {
    const before: AppState = {
      accounts: [{ ...baseAccount, externalId: 'old-session-acct' }],
      transactions: [{ id: 'connector:enablebanking:old-session-acct:tx-1', accountId: ACCOUNT_ID, description: 'REWE', category: 'Groceries', type: 'expense', amountCents: 2000, date: '2026-08-27' }],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ ...basePayloadAccount, externalId: 'new-session-acct' }],
      // A genuinely different transaction that happens to share date/amount/
      // description with the pre-existing one, arriving with NO stable
      // transaction identity -- must NOT be silently discarded.
      transactions: [{ externalId: 'new-session-acct:2026-08-27:-20.00:REWE', externalAccountId: 'new-session-acct', description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' }],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(1)
    expect(preview.duplicateCount).toBe(0)
  })

  // Corrected 2026-08-27 (PR #154, third independent review): renamed from
  // its previous claim ("remains exactly one copy ... fingerprint dedup is
  // unaffected") -- that framing described the exact bug Blocker 3 requires
  // fixing (relying on date/amount/description as authoritative dedup
  // evidence). With a genuinely different provider transaction id and no
  // stableTransactionId, this transaction must now be preserved, not
  // dropped -- see the routine-refresh describe block below for the
  // realistic version of this scenario where the id DOES match (an
  // ordinary same-session refresh), which is correctly deduped via exact id.
  it('F. routine re-sync, no stable id on either side, DIFFERENT exact provider id from history -> preserved, never dropped based on date/amount/description alone', () => {
    const before: AppState = {
      accounts: [baseAccount],
      transactions: [{ id: 'connector:enablebanking:tx-0', accountId: ACCOUNT_ID, description: 'REWE', category: 'Groceries', type: 'expense', amountCents: 2000, date: '2026-08-27' }],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [{ externalId: 'tx-1', externalAccountId: 'acct-1', description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27' }],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.transactionsToImport).toHaveLength(1)
    expect(preview.duplicateCount).toBe(0)
  })

  it('G. pending -> booked lifecycle: a pending transaction is excluded from import, and its later booked counterpart is not treated as a false duplicate', () => {
    const before: AppState = { accounts: [baseAccount], transactions: [], goals: [] }
    const pendingSync: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [{ externalId: 'tx-1', externalAccountId: 'acct-1', stableTransactionId: 'a1'.padEnd(64, '0'), description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27', pending: true }],
    }
    const pendingPreview = buildSyncPreview(before, pendingSync)
    expect(pendingPreview.transactionsToImport).toHaveLength(0)
    expect(pendingPreview.pendingCount).toBe(1)

    // The same economic transaction later books -- same stableTransactionId,
    // now pending:false -- imports exactly once (state is unchanged from
    // before, since the pending version was never actually imported).
    const bookedSync: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [basePayloadAccount],
      transactions: [{ externalId: 'tx-1', externalAccountId: 'acct-1', stableTransactionId: 'a1'.padEnd(64, '0'), description: 'REWE', amountCents: -2000, currency: 'EUR', bookingDate: '2026-08-27', pending: false }],
    }
    const bookedPreview = buildSyncPreview(before, bookedSync)
    expect(bookedPreview.transactionsToImport).toHaveLength(1)
    expect(bookedPreview.duplicateCount).toBe(0)
  })
})

// Blocker 1 (found by independent review, 2026-08-27): a routine "click
// Refresh" on an already-connected account (same provider session, same
// externalId -- no reauthorization) previously produced no update at all --
// buildSyncPreview()'s existingById match just continued without refreshing
// balance/lastSyncedAt, and ConnectionsPage.tsx's synchronize() only ever
// applied anything when accountsToCreate/accountsToUpdate were non-empty,
// so a genuinely new transaction on an existing account could be silently
// dropped from the UI entirely (never imported, never shown). See
// SyncPreview.routineAccountUpdates's doc comment in src/connectors.ts.
describe('routine refresh (Blocker 1: same connection, no reauthorization)', () => {
  it('refreshes balance in place, re-affirms an existing transaction without duplicating it, and imports a genuinely new one -- all without touching accountsToCreate/accountsToUpdate', () => {
    const accountId = 'connector:enablebanking:acct-1'
    const before: AppState = {
      accounts: [{ id: accountId, externalId: 'acct-1', name: 'Girokonto', type: 'checking', balanceCents: 10_000, currency: 'EUR' }],
      transactions: [{ id: 'connector:enablebanking:tx-a', accountId, description: 'Transaction A', category: 'Sonstiges', type: 'expense', amountCents: 1_000, date: '2026-08-20' }],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'acct-1', name: 'Girokonto', type: 'checking', balanceCents: 12_000, currency: 'EUR' }],
      transactions: [
        { externalId: 'tx-a', externalAccountId: 'acct-1', description: 'Transaction A', amountCents: -1_000, currency: 'EUR', bookingDate: '2026-08-20' },
        { externalId: 'tx-b', externalAccountId: 'acct-1', description: 'Transaction B', amountCents: -500, currency: 'EUR', bookingDate: '2026-08-21' },
      ],
    }

    const preview = buildSyncPreview(before, payload)
    expect(preview.accountsToCreate).toHaveLength(0)
    expect(preview.accountsToUpdate).toHaveLength(0)
    expect(preview.routineAccountUpdates).toHaveLength(1)
    expect(preview.routineAccountUpdates[0].id).toBe(accountId)
    expect(preview.routineAccountUpdates[0].balanceCents).toBe(12_000)
    expect(preview.transactionsToImport).toHaveLength(1)
    expect(preview.transactionsToImport[0].description).toBe('Transaction B')
    expect(preview.duplicateCount).toBe(1)

    const applied = applySyncPreview(before, preview)
    expect(applied.accounts).toHaveLength(1)
    expect(applied.accounts[0].id).toBe(accountId)
    expect(applied.accounts[0].balanceCents).toBe(12_000)
    expect(applied.transactions.filter((t) => t.description === 'Transaction A')).toHaveLength(1)
    expect(applied.transactions.filter((t) => t.description === 'Transaction B')).toHaveLength(1)

    // A repeated, identical refresh imports zero more rows.
    const secondPreview = buildSyncPreview(applied, payload)
    expect(secondPreview.transactionsToImport).toHaveLength(0)
    expect(secondPreview.duplicateCount).toBe(2)
    const secondApplied = applySyncPreview(applied, secondPreview)
    expect(secondApplied.accounts).toHaveLength(1)
    expect(secondApplied.transactions).toHaveLength(2)
  })
})

// Blocker 2 (found by independent review, 2026-08-27): "TEST LEGACY
// UPGRADE" -- an account/transaction imported before stableId/
// stableTransactionId existed must be safely upgraded, in place, on its
// next ordinary sync, so that a LATER genuine reconnect (new provider
// session) can recognize it via stableId rather than minting a duplicate.
describe('legacy identity backfill and later reconnect (Blocker 2: TEST LEGACY UPGRADE)', () => {
  it('backfills stableId/stableTransactionId on a same-session sync, then correctly reconnects via the newly-backfilled stableId on a later reauthorization', () => {
    const STABLE_ID = '7'.repeat(64)
    const STABLE_TX_ID = '8'.repeat(64)
    const legacyAccountId = 'connector:enablebanking:old-session-uid'
    const legacyTransactionId = 'connector:enablebanking:hist-tx-1'
    const legacy: AppState = {
      accounts: [{ id: legacyAccountId, externalId: 'old-session-uid', name: 'Girokonto', type: 'checking', balanceCents: 50_000, currency: 'EUR' }],
      transactions: [{ id: legacyTransactionId, accountId: legacyAccountId, description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 80_000, date: '2026-07-01' }],
      goals: [],
    }

    // Phase 1: SAME session, same externalId -- an ordinary routine sync
    // under the new code, now carrying a stableId/stableTransactionId the
    // legacy rows never had.
    const sameSessionPayload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 55_000, currency: 'EUR' }],
      transactions: [{ externalId: 'hist-tx-1', externalAccountId: 'old-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Miete', amountCents: -80_000, currency: 'EUR', bookingDate: '2026-07-01' }],
    }
    const phase1Preview = buildSyncPreview(legacy, sameSessionPayload)
    expect(phase1Preview.accountsToCreate).toHaveLength(0)
    expect(phase1Preview.accountsToUpdate).toHaveLength(0)
    expect(phase1Preview.routineAccountUpdates).toHaveLength(1)
    expect(phase1Preview.routineAccountUpdates[0].id).toBe(legacyAccountId)
    expect(phase1Preview.routineAccountUpdates[0].stableId).toBe(STABLE_ID)
    expect(phase1Preview.routineAccountUpdates[0].balanceCents).toBe(55_000)
    expect(phase1Preview.transactionsToImport).toHaveLength(0)
    expect(phase1Preview.transactionsToUpdate).toHaveLength(1)
    expect(phase1Preview.transactionsToUpdate[0].id).toBe(legacyTransactionId)
    expect(phase1Preview.transactionsToUpdate[0].stableTransactionId).toBe(STABLE_TX_ID)

    const afterPhase1 = applySyncPreview(legacy, phase1Preview)
    expect(afterPhase1.accounts).toHaveLength(1)
    expect(afterPhase1.accounts[0].id).toBe(legacyAccountId)
    expect(afterPhase1.accounts[0].stableId).toBe(STABLE_ID)
    const upgradedHistoricalTransaction = afterPhase1.transactions.find((t) => t.id === legacyTransactionId)
    expect(upgradedHistoricalTransaction?.stableTransactionId).toBe(STABLE_TX_ID)
    // The backfill never touches economic fields.
    expect(upgradedHistoricalTransaction?.amountCents).toBe(80_000)
    expect(upgradedHistoricalTransaction?.description).toBe('Miete')

    // Phase 2: simulate a brand-new Enable Banking authorization -- a NEW
    // session account uid, but the SAME identification_hash-derived
    // stableId and the SAME historical entry_reference-derived stable
    // transaction id.
    const reauthPayload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'brand-new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 60_000, currency: 'EUR' }],
      transactions: [
        { externalId: 'hist-tx-1-new-ref', externalAccountId: 'brand-new-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Miete', amountCents: -80_000, currency: 'EUR', bookingDate: '2026-07-01' },
        { externalId: 'new-tx-1', externalAccountId: 'brand-new-session-uid', stableTransactionId: '9'.repeat(64), description: 'Gehalt', amountCents: 300_000, currency: 'EUR', bookingDate: '2026-08-01' },
      ],
    }
    const phase2Preview = buildSyncPreview(afterPhase1, reauthPayload)
    expect(phase2Preview.accountsToCreate).toHaveLength(0)
    expect(phase2Preview.accountsToUpdate).toHaveLength(1)
    expect(phase2Preview.accountsToUpdate[0].id).toBe(legacyAccountId)
    expect(phase2Preview.accountsToUpdate[0].externalId).toBe('brand-new-session-uid')
    expect(phase2Preview.transactionsToImport).toHaveLength(1)
    expect(phase2Preview.transactionsToImport[0].description).toBe('Gehalt')
    expect(phase2Preview.duplicateCount).toBe(1)

    const afterPhase2 = applySyncPreview(afterPhase1, phase2Preview)
    expect(afterPhase2.accounts).toHaveLength(1)
    expect(afterPhase2.accounts[0].id).toBe(legacyAccountId)
    expect(afterPhase2.transactions).toHaveLength(2)
  })
})

// Blocker 2 (found by independent review, 2026-08-27): when safe backfill
// genuinely is impossible -- an existing provider account this sync could
// neither exact-id-match nor stableId-match -- the account must never be
// silently fuzzy-merged into (or silently superseded by) a newly-created
// account. It is surfaced via unreconciledLegacyAccounts so the UI can warn
// the user to check for a duplicate manually.
describe('unreconciled legacy accounts (Blocker 2: ambiguous legacy reconnect)', () => {
  it('surfaces an existing provider account that could not be matched by id or stableId this sync, rather than silently ignoring it', () => {
    const orphanedAccountId = 'connector:enablebanking:orphaned-old-session'
    const before: AppState = {
      accounts: [{ id: orphanedAccountId, externalId: 'orphaned-old-session', institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Altes Konto', type: 'checking', balanceCents: 1_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected', institutionId: 'SPARKASSE_AACHEN_AACSDE33' },
      accounts: [{ externalId: 'genuinely-new-session', stableId: 'b'.repeat(64), institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Girokonto', type: 'checking', balanceCents: 5_000, currency: 'EUR' }],
      transactions: [],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.accountsToCreate).toHaveLength(1)
    expect(preview.unreconciledLegacyAccounts).toHaveLength(1)
    expect(preview.unreconciledLegacyAccounts[0].id).toBe(orphanedAccountId)
  })

  it('does not surface an account that this sync itself successfully claimed by exact id or stableId', () => {
    const accountId = 'connector:enablebanking:acct-1'
    const before: AppState = {
      accounts: [{ id: accountId, externalId: 'acct-1', institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Girokonto', type: 'checking', balanceCents: 1_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected', institutionId: 'SPARKASSE_AACHEN_AACSDE33' },
      accounts: [{ externalId: 'acct-1', institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Girokonto', type: 'checking', balanceCents: 1_500, currency: 'EUR' }],
      transactions: [],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.unreconciledLegacyAccounts).toHaveLength(0)
  })

  // Found by adversarial review (2026-08-27): the id prefix
  // `connector:${provider}:` only encodes which PROVIDER an account came
  // from, never which specific BANK connection produced it. The realistic
  // trigger (the credential store keeps one row per user+provider -- see
  // the doc comment in connectors.ts) is sequential, not simultaneous: the
  // user disconnected an old GoCardless bank (keeping its accounts/history
  // locally, per Bank Disconnect Flow) and later connected a DIFFERENT bank
  // through the same provider. Syncing the new bank must not flag the old
  // bank's untouched local accounts as "unreconciled" purely because they
  // share one provider.
  it('does not flag an account left over from a DIFFERENT, previously-disconnected bank on the same provider (institutionId differs)', () => {
    const otherConnectionAccountId = 'connector:gocardless:other-bank-acct'
    const before: AppState = {
      accounts: [{ id: otherConnectionAccountId, externalId: 'other-bank-acct', institutionId: 'DEUTSCHE_BANK_DEUTDEFF', name: 'Deutsche Bank Girokonto', type: 'checking', balanceCents: 1_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'gocardless', displayName: 'Sparkasse', status: 'connected', institutionId: 'SPARKASSE_AACHEN_AACSDE33' },
      accounts: [{ externalId: 'sparkasse-acct', stableId: 'b'.repeat(64), institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Sparkasse Girokonto', type: 'checking', balanceCents: 5_000, currency: 'EUR' }],
      transactions: [],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.unreconciledLegacyAccounts).toHaveLength(0)
  })

  // Found by adversarial review (2026-08-27): a legacy account (or one
  // whose owning connection the user genuinely disconnected) that lacks
  // institutionId can never be reliably tied to a specific connection, so
  // it must never be flagged -- otherwise it would nag on every future
  // sync of any same-provider connection, forever, with no way to silence
  // it (Remove account itself requires a stableId this class of account
  // never has).
  it('does not flag an account with no institutionId to compare, even if its provider matches', () => {
    const noInstitutionAccountId = 'connector:enablebanking:no-institution-old-session'
    const before: AppState = {
      accounts: [{ id: noInstitutionAccountId, externalId: 'no-institution-old-session', name: 'Altes Konto', type: 'checking', balanceCents: 1_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    const payload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected', institutionId: 'SPARKASSE_AACHEN_AACSDE33' },
      accounts: [{ externalId: 'genuinely-new-session', stableId: 'b'.repeat(64), institutionId: 'SPARKASSE_AACHEN_AACSDE33', name: 'Girokonto', type: 'checking', balanceCents: 5_000, currency: 'EUR' }],
      transactions: [],
    }
    const preview = buildSyncPreview(before, payload)
    expect(preview.unreconciledLegacyAccounts).toHaveLength(0)
  })
})

// CURRENT DUPLICATE RECOVERY (fourth independent review, 2026-08-27): the
// exact state this codebase's own previous live Mock ASPSP passes created
// -- two provider-linked Finance Planner accounts both representing the
// same real Mock account, BOTH still lacking stableId (imported before it
// existed): Account A under an old, now-stale session externalId, Account
// B under the CURRENT session's externalId. A routine sync of the current
// connection must upgrade B in place (backfilling stableId/
// stableTransactionId) while leaving A completely untouched -- Finance
// Planner must never auto-merge or auto-delete A, since there is no
// trustworthy identity linking it to B.
describe('current duplicate recovery (legacy accounts both lacking stableId)', () => {
  it('a routine sync of the current session backfills stableId/stableTransactionId onto Account B only; Account A is left untouched', () => {
    const accountAId = 'connector:enablebanking:old-session-uid'
    const accountBId = 'connector:enablebanking:current-session-uid'
    const before: AppState = {
      accounts: [
        { id: accountAId, externalId: 'old-session-uid', name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' },
        { id: accountBId, externalId: 'current-session-uid', name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' },
      ],
      transactions: [
        { id: 'connector:enablebanking:a-hist-1', accountId: accountAId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' },
        { id: 'connector:enablebanking:b-hist-1', accountId: accountBId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' },
      ],
      goals: [],
    }
    const STABLE_ID = 'c'.repeat(64)
    const STABLE_TX_ID = 'd'.repeat(64)
    const routineSyncPayload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'current-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' }],
      transactions: [{ externalId: 'b-hist-1', externalAccountId: 'current-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' }],
    }

    const preview = buildSyncPreview(before, routineSyncPayload)
    // Account B exact-id matches -- routine refresh, not a create/reconnect.
    expect(preview.accountsToCreate).toHaveLength(0)
    expect(preview.accountsToUpdate).toHaveLength(0)
    expect(preview.routineAccountUpdates).toHaveLength(1)
    expect(preview.routineAccountUpdates[0].id).toBe(accountBId)
    expect(preview.routineAccountUpdates[0].stableId).toBe(STABLE_ID)
    // B's exact current-session transaction backfills stableTransactionId.
    expect(preview.transactionsToUpdate).toHaveLength(1)
    expect(preview.transactionsToUpdate[0].id).toBe('connector:enablebanking:b-hist-1')
    expect(preview.transactionsToUpdate[0].stableTransactionId).toBe(STABLE_TX_ID)
    expect(preview.transactionsToImport).toHaveLength(0)

    const applied = applySyncPreview(before, preview)
    // Finance Planner does NOT auto-merge/delete Account A -- both accounts
    // still exist, A completely unchanged.
    expect(applied.accounts).toHaveLength(2)
    const accountA = applied.accounts.find((account) => account.id === accountAId)
    const accountB = applied.accounts.find((account) => account.id === accountBId)
    expect(accountA).toEqual(before.accounts[0])
    expect(accountB?.stableId).toBe(STABLE_ID)
    expect(accountB?.balanceCents).toBe(695_950)
    const accountATransaction = applied.transactions.find((transaction) => transaction.id === 'connector:enablebanking:a-hist-1')
    expect(accountATransaction).toEqual(before.transactions[0])
    const accountBTransaction = applied.transactions.find((transaction) => transaction.id === 'connector:enablebanking:b-hist-1')
    expect(accountBTransaction?.stableTransactionId).toBe(STABLE_TX_ID)
  })

  it('syncing B again after local legacy removal of A does not resurrect A, and stays clean if the provider only ever returns B', () => {
    const accountBId = 'connector:enablebanking:current-session-uid'
    const STABLE_ID = 'c'.repeat(64)
    const STABLE_TX_ID = 'd'.repeat(64)
    // Simulates the state right after the user manually removed Account A
    // via Dashboard -> "Remove local legacy account" -- only B remains.
    const afterLegacyRemoval: AppState = {
      accounts: [{ id: accountBId, externalId: 'current-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' }],
      transactions: [{ id: 'connector:enablebanking:b-hist-1', accountId: accountBId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01', stableTransactionId: STABLE_TX_ID }],
      goals: [],
    }
    const repeatedSyncPayload: SyncPayload = {
      connection: { id: 'c', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'current-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' }],
      transactions: [{ externalId: 'b-hist-1', externalAccountId: 'current-session-uid', stableTransactionId: STABLE_TX_ID, description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' }],
    }
    const preview = buildSyncPreview(afterLegacyRemoval, repeatedSyncPayload)
    expect(preview.accountsToCreate).toHaveLength(0)
    expect(preview.accountsToUpdate).toHaveLength(0)
    const applied = applySyncPreview(afterLegacyRemoval, preview)
    expect(applied.accounts).toHaveLength(1)
    expect(applied.accounts[0].id).toBe(accountBId)
  })
})
