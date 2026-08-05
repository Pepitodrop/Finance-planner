import { describe, expect, it } from 'vitest'
import { recurringPresentation } from './recurringModel'

describe('recurring presentation', () => {
  it('uses detector records and excludes recurring income', () => {
    const transactions = [
      { id: 'e', accountId: 'a', description: 'Rent', category: 'Housing', type: 'expense' as const, amountCents: 90_000, date: '2026-01-01', recurring: true },
      { id: 'i', accountId: 'a', description: 'Salary', category: 'Income', type: 'income' as const, amountCents: 200_000, date: '2026-01-01', recurring: true },
    ]
    const result = recurringPresentation(transactions)
    expect(result.items).toHaveLength(1)
    expect(result.monthlyTotalCents).toBe(90_000)
  })
  it('returns an honest empty result', () => expect(recurringPresentation([])).toEqual({ items: [], monthlyTotalCents: 0 }))
})
