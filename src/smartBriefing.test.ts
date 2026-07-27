import { describe, expect, it } from 'vitest'
import { createSmartBriefing } from './smartBriefing'
import type { AppState } from './types'

const state: AppState = {
  accounts: [{ id: 'checking', name: 'Girokonto', type: 'checking', balanceCents: 120000, currency: 'EUR' }],
  goals: [{ id: 'holiday', name: 'Urlaub', currentCents: 20000, targetCents: 80000, targetDate: '2026-09-15' }],
  transactions: [
    { id: 'income', accountId: 'checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 250000, date: '2026-07-10' },
    { id: 'rent', accountId: 'checking', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 100000, date: '2026-07-11', recurring: true },
    { id: 'food', accountId: 'checking', description: 'Lebensmittel', category: 'Lebensmittel', type: 'expense', amountCents: 70000, date: '2026-07-12' },
    { id: 'old-rent', accountId: 'checking', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 80000, date: '2026-06-10', recurring: true },
    { id: 'old-food', accountId: 'checking', description: 'Lebensmittel', category: 'Lebensmittel', type: 'expense', amountCents: 30000, date: '2026-06-12' },
  ],
}

describe('createSmartBriefing', () => {
  it('prioritizes critical liquidity before overspending', () => {
    const briefing = createSmartBriefing(state, new Date('2026-07-27T12:00:00Z'))
    expect(briefing[0]?.id).toBe('cash-runway')
    expect(briefing[0]?.severity).toBe('attention')
    expect(briefing.some((item) => item.id === 'spending-trend' && item.severity === 'attention')).toBe(true)
    expect(briefing.some((item) => item.id === 'savings-rate')).toBe(true)
  })

  it('returns at most four ranked insights', () => {
    const briefing = createSmartBriefing(state, new Date('2026-07-27T12:00:00Z'))
    expect(briefing.length).toBeLessThanOrEqual(4)
    expect(briefing.every((item, index) => index === 0 || briefing[index - 1]!.priority >= item.priority)).toBe(true)
  })
})
