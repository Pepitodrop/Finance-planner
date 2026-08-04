import { describe, expect, it } from 'vitest'
import type { AppState } from '../../types'
import { buildDashboardViewModel, isDetectedTransfer } from './dashboardModel'

const state: AppState = {
  accounts: [
    { id: 'checking', name: 'Primary account', type: 'checking', balanceCents: 425_050, currency: 'EUR' },
    { id: 'savings', name: 'Savings', type: 'savings', balanceCents: 200_000, currency: 'EUR' },
  ],
  transactions: [
    { id: 'income-current', accountId: 'checking', description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' },
    { id: 'housing-current', accountId: 'checking', description: 'Rent', category: 'Housing', type: 'expense', amountCents: 80_000, date: '2026-08-02' },
    { id: 'food-current', accountId: 'checking', description: 'Market', category: 'Food', type: 'expense', amountCents: 20_000, date: '2026-08-03' },
    { id: 'income-prior', accountId: 'checking', description: 'Prior salary', category: 'Income', type: 'income', amountCents: 100_000, date: '2026-07-01' },
    { id: 'expense-prior', accountId: 'checking', description: 'Prior rent', category: 'Housing', type: 'expense', amountCents: 50_000, date: '2026-07-02' },
  ],
  goals: [{ id: 'goal', name: 'Emergency fund', targetCents: 1_000_000, currentCents: 425_000, targetDate: '2027-01-01' }],
}

describe('dashboard view model', () => {
  const model = buildDashboardViewModel(state, new Date(2026, 7, 4, 19))

  it('uses deterministic balances and current-calendar-month totals', () => {
    expect(model.periodLabel).toBe('August 2026')
    expect(model.totalBalanceCents).toBe(625_050)
    expect(model.incomeCents).toBe(250_000)
    expect(model.expenseCents).toBe(100_000)
    expect(model.surplusCents).toBe(150_000)
  })

  it('starts the future-only projection at the genuine current balance', () => {
    expect(model.projection).toHaveLength(13)
    expect(model.projection[0]).toEqual({
      month: 'Today',
      balance: 6250.5,
      currentBalance: 6250.5,
      projectedBalance: 6250.5,
    })
    expect(model.projection.slice(1).every((point) => point.projectedBalance === point.balance)).toBe(true)
  })

  it('uses only current-month expenses for category totals and valid percentages', () => {
    expect(model.categories).toEqual([
      { name: 'Housing', amountCents: 80_000, percentage: 80 },
      { name: 'Food', amountCents: 20_000, percentage: 20 },
    ])
    expect(model.categories.reduce((sum, category) => sum + category.amountCents, 0)).toBe(model.expenseCents)
  })

  it('derives tested goal progress and recent ordering without changing source state', () => {
    expect(model.goals[0].progress).toBe(43)
    expect(model.recentTransactions.map(({ id }) => id).slice(0, 3)).toEqual(['food-current', 'housing-current', 'income-current'])
  })

  it('preserves the existing transfer inference semantics for presentation', () => {
    expect(isDetectedTransfer({ id: 't', accountId: 'checking', description: 'Transfer to savings', category: 'Savings', type: 'expense', amountCents: 1000, date: '2026-08-04' })).toBe(true)
  })
})
