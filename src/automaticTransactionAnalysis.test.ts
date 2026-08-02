import { describe, expect, it } from 'vitest'
import { createAutomaticTransactionAnalysis, transactionAnalysisRevision } from './automaticTransactionAnalysis'
import type { AppState } from './types'

const state: AppState = {
  accounts: [{ id: 'checking', name: 'Girokonto', type: 'checking', balanceCents: 250000, currency: 'EUR' }],
  goals: [],
  transactions: [
    { id: 'salary', accountId: 'checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 300000, date: '2026-08-01', recurring: true },
    { id: 'rent', accountId: 'checking', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 90000, date: '2026-08-02', recurring: true },
  ],
}

describe('automatic transaction analysis', () => {
  it('changes its revision whenever transaction facts change', () => {
    const first = transactionAnalysisRevision(state)
    const changed = { ...state, transactions: state.transactions.map((item) => item.id === 'rent' ? { ...item, amountCents: 95000 } : item) }
    expect(transactionAnalysisRevision(changed)).not.toBe(first)
  })

  it('creates a deterministic analysis without external AI consent', () => {
    const result = createAutomaticTransactionAnalysis(state)
    expect(result.length).toBeGreaterThan(40)
    expect(result).toMatch(/Einnah|Ausgab|Spar|Liquid|Monat/i)
  })

  it('handles an empty transaction history', () => {
    expect(createAutomaticTransactionAnalysis({ ...state, transactions: [] })).toMatch(/automatisch/i)
  })
})
