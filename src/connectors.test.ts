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

  it('B. reauthorization: same stable economic account, NEW session externalId, same historical transactions -> reuses the existing Finance Planner account id, updates balance in place, does not duplicate historical transactions', () => {
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR', lastSyncedAt: '2026-08-26T00:00:00.000Z' }],
      transactions: [{ id: 'connector:enablebanking:old-session-uid:mock-tx-001', accountId: existingAccountId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' }],
      goals: [],
    }
    const reconnectPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' }],
      transactions: [{ externalId: 'mock-tx-001', externalAccountId: 'new-session-uid', description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' }],
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

  it('E. new real transaction after reconnect: old rows dedup, the genuinely new transaction imports exactly once', () => {
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const before: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 250_000, currency: 'EUR' }],
      transactions: [{ id: 'connector:enablebanking:old-session-uid:mock-tx-001', accountId: existingAccountId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' }],
      goals: [],
    }
    const reconnectPayload: SyncPayload = {
      connection: { id: 'connection-1', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: STABLE_ID, name: 'Girokonto', type: 'checking', balanceCents: 300_000, currency: 'EUR' }],
      transactions: [
        { externalId: 'mock-tx-001', externalAccountId: 'new-session-uid', description: 'Salary', amountCents: 250_000, currency: 'EUR', bookingDate: '2026-08-01' },
        { externalId: 'mock-tx-002', externalAccountId: 'new-session-uid', description: 'Freelance payment', amountCents: 50_000, currency: 'EUR', bookingDate: '2026-08-15' },
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
