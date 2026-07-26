import { describe, expect, it } from 'vitest'
import { currentMonthTotals, monthlyProjection, totalBalance } from './finance'
import type { AppState } from './types'

const state: AppState = {
  accounts: [{ id: 'a', name: 'Konto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
  transactions: [
    { id: 'i1', accountId: 'a', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 200_000, date: '2026-06-01' },
    { id: 'e1', accountId: 'a', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 80_000, date: '2026-06-02' },
    { id: 'i2', accountId: 'a', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 220_000, date: '2026-07-01' },
    { id: 'e2', accountId: 'a', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 80_000, date: '2026-07-02' },
  ],
  goals: [],
}

describe('finance calculations', () => {
  it('sums account balances in cents', () => {
    expect(totalBalance(state)).toBe(100_000)
  })

  it('uses the supplied reference month', () => {
    expect(currentMonthTotals(state.transactions, new Date(2026, 6, 15))).toEqual({ incomeCents: 220_000, expenseCents: 80_000 })
  })

  it('projects from average observed monthly cash flow without repeating every historic item independently', () => {
    const projection = monthlyProjection(state, 2, new Date(2026, 6, 15))
    expect(projection).toHaveLength(2)
    expect(projection[0].balance).toBe(2300)
    expect(projection[1].balance).toBe(3600)
  })
})
