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

  it('includes income booked on the first day of the current month', () => {
    const productionRegressionState: AppState = {
      accounts: [{ id: 'checking', name: 'Girokonto', type: 'checking', balanceCents: 695950, currency: 'EUR' }],
      goals: [],
      transactions: [
        { id: 'salary', accountId: 'checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
        { id: 'job', accountId: 'checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
        { id: 'rent', accountId: 'checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
        { id: 'ticket', accountId: 'checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
        { id: 'gym', accountId: 'checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
        { id: 'market', accountId: 'checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
        { id: 'restaurant', accountId: 'checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
        { id: 'game', accountId: 'checking', description: 'Minecraft', category: 'Game', type: 'expense', amountCents: 10000, date: '2026-07-29' },
        { id: 'rewe', accountId: 'checking', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 9000, date: '2026-07-30' },
      ],
    }

    const briefing = createSmartBriefing(productionRegressionState, new Date('2026-07-31T19:40:00+02:00'))

    expect(briefing).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'savings-rate', title: 'Sparquote 55 %', severity: 'positive' }),
      expect.objectContaining({ id: 'cash-runway', title: '6,3 Monate Reichweite', severity: 'positive' }),
    ]))
    expect(briefing.some((item) => item.id === 'recurring-load')).toBe(false)
  })
})
