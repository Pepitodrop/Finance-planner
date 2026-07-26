import { describe, expect, it } from 'vitest'
import { applySyncPreview, buildSyncPreview, transactionFingerprint, type SyncPayload } from './connectors'
import type { AppState, Transaction } from './types'

const state: AppState = {
  accounts: [{ id: 'manual', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
  transactions: [{ id: 'existing', accountId: 'manual', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 2500, date: '2026-07-20' }],
  goals: [],
}

const payload: SyncPayload = {
  connection: { id: 'connection-1', provider: 'gocardless', displayName: 'Testbank', status: 'connected' },
  accounts: [{ externalId: 'bank-account-1', name: 'Testbank Giro', type: 'checking', balanceCents: 250_000, currency: 'EUR' }],
  transactions: [
    { externalId: 'tx-1', externalAccountId: 'bank-account-1', description: 'Gehalt Juli', amountCents: 200_000, currency: 'EUR', bookingDate: '2026-07-25' },
    { externalId: 'tx-2', externalAccountId: 'bank-account-1', description: 'Kartenzahlung Café', amountCents: -850, currency: 'EUR', bookingDate: '2026-07-24' },
    { externalId: 'tx-pending', externalAccountId: 'bank-account-1', description: 'Vorgemerkt', amountCents: -5000, currency: 'EUR', bookingDate: '2026-07-26', pending: true },
  ],
}

describe('connector sync', () => {
  it('builds a preview and skips pending transactions', () => {
    const preview = buildSyncPreview(state, payload)
    expect(preview.accountsToCreate).toHaveLength(1)
    expect(preview.transactionsToImport).toHaveLength(2)
    expect(preview.pendingCount).toBe(1)
    expect(preview.transactionsToImport[0].type).toBe('income')
    expect(preview.transactionsToImport[1].type).toBe('expense')
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
